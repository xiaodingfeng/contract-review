/**
 * @file routes/knowledge.js
 * @brief 知识库管理路由,负责法律法条与案例的导入、检索、同步与重建
 *
 * 核心职责：
 * - 提供知识库模板下载、向量检索、列表、单条/批量导入、删除等接口
 * - 支持法律 Markdown 解析与案例 JSON 解析,自动入库向量库
 * - 通过 SSE 流式返回向量数据库重建进度
 * - 提供法律版本同步与时间线查询接口
 *
 * 关键实现：
 * - 使用 multer 处理批量文件上传,支持 docx/pdf 文本提取
 * - normalizeKnowledgeEntries 自动识别法律 Markdown 并拆分为条款级条目
 * - /rebuild 接口通过 SSE 推送 clearing/law/case/complete 各阶段进度
 * - /laws/sync 支持传入文件路径或 Markdown 内容同步法律版本
 *
 * 依赖关系：
 * - 上游：express、multer、mammoth、pdf-parse、database、services/vectorStore、services/legalMarkdownParser、services/lawSync
 * - 下游：被 index.js 挂载到 /api/knowledge
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');
const db = require('../database');
const {
    importKnowledgeEntries,
    searchVectorDocuments,
    deleteKnowledgeDocuments,
    listKnowledgeDocuments,
    seedLawsFromMarkdown,
    seedCasesFromJson,
    clearAllVectorDocuments,
} = require('../services/vectorStore');
const { parseLegalMarkdown, parseLegalMarkdownFile } = require('../services/legalMarkdownParser');
const lawSync = require('../services/lawSync');

const router = express.Router();
const BATCH_IMPORT_FILE_LIMIT = Math.max(1, Number(process.env.KNOWLEDGE_BATCH_FILE_LIMIT || 200));
const BATCH_IMPORT_ENTRY_SIZE = Math.max(1, Number(process.env.KNOWLEDGE_BATCH_ENTRY_SIZE || 50));
const upload = multer({
    dest: path.join(__dirname, '..', 'uploads', 'knowledge'),
    limits: {
        files: BATCH_IMPORT_FILE_LIMIT,
        fileSize: Math.max(1024 * 1024, Number(process.env.KNOWLEDGE_IMPORT_FILE_SIZE_LIMIT || 50 * 1024 * 1024)),
    },
});
const legalTemplatePath = path.join(__dirname, '..', 'data', '法律法规模版.md');
const caseTemplatePath = path.join(__dirname, '..', 'data', '裁判文书模版.json');

const extractTextFromFile = async (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.docx') {
        const { value } = await mammoth.extractRawText({ path: filePath });
        return value;
    }
    if (ext === '.pdf') {
        const data = await pdf(fs.readFileSync(filePath));
        return data.text;
    }
    return fs.readFileSync(filePath, 'utf8');
};

const looksLikeLegalMarkdown = (content) => String(content || '').includes('<!-- INFO END -->')
    && /^第[〇零一二两三四五六七八九十百千万亿\d]+条/m.test(content);

const normalizeKnowledgeEntries = (incoming) => {
    const normalized = [];
    for (const entry of incoming) {
        if (!entry) continue;
        const sourceType = entry.source_type || entry.sourceType || entry.type;
        const isLegalMarkdown = entry.format === 'legal_markdown'
            || entry.format === 'markdown'
            || sourceType === 'law_markdown'
            || (sourceType === 'law' && looksLikeLegalMarkdown(entry.content));

        if (isLegalMarkdown) {
            normalized.push(...parseLegalMarkdown(entry.content, {
                sourceFile: entry.source_name || entry.sourceName || entry.title || '',
                sourceUrl: entry.source_url || entry.sourceUrl || '',
            }));
            continue;
        }
        normalized.push(entry);
    }
    return normalized;
};

router.get('/template', (req, res) => {
    const templateType = String(req.query.type || '').trim().toLowerCase();
    const templatePath = templateType === 'case' ? caseTemplatePath : legalTemplatePath;
    const downloadName = templateType === 'case' ? '裁判文书模版.json' : '法律法规模版.md';
    if (!fs.existsSync(templatePath)) {
        return res.status(404).json({ error: 'Knowledge template not found.' });
    }
    res.download(templatePath, downloadName);
});

router.get('/case-template', (req, res) => {
    if (!fs.existsSync(caseTemplatePath)) {
        return res.status(404).json({ error: 'Case knowledge template not found.' });
    }
    res.download(caseTemplatePath, '裁判文书模版.json');
});

router.get('/search', async (req, res) => {
    try {
        const query = String(req.query.q || req.query.query || '').trim();
        const sourceTypes = String(req.query.types || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);

        const results = await searchVectorDocuments(query || '合同 法律 条文 裁判 文书', {
            limit: Number(req.query.limit || 20),
            sourceTypes,
            rerank: String(req.query.rerank || '').toLowerCase() !== 'false',
        });

        res.json(results);
    } catch (error) {
        console.error('[ERROR] Knowledge vector search failed:', error);
        res.status(500).json({ error: 'Knowledge vector search failed.' });
    }
});

router.get('/list', async (req, res) => {
    try {
        const result = await listKnowledgeDocuments({
            page: req.query.page,
            pageSize: req.query.pageSize,
            query: req.query.q || req.query.query || '',
            sourceType: req.query.type || req.query.source_type || '',
            lawStatus: req.query.law_status || '',
        });
        res.json(result);
    } catch (error) {
        console.error('[ERROR] Knowledge list failed:', error);
        res.status(500).json({ error: 'Knowledge list failed.' });
    }
});

router.post('/import', async (req, res) => {
    const incoming = Array.isArray(req.body) ? req.body : req.body?.laws || req.body?.documents;
    if (!Array.isArray(incoming)) {
        return res.status(400).json({ error: 'Expected an array or { laws/documents: [...] }.' });
    }

    const normalizedEntries = normalizeKnowledgeEntries(incoming);
    const validEntries = normalizedEntries.filter((entry) => {
        if (!entry || typeof entry.title !== 'string') return false;
        if (Array.isArray(entry.key_clauses)) {
            return entry.key_clauses.every((clause) => clause && clause.id && clause.content);
        }
        return typeof entry.content === 'string' && entry.content.trim();
    });

    if (validEntries.length !== normalizedEntries.length) {
        return res.status(400).json({
            error: 'Each entry requires title plus either key_clauses[] or content. Legal Markdown entries must follow the provided template.',
        });
    }

    try {
        const imported = await importKnowledgeEntries(validEntries);
        res.status(201).json(imported);
    } catch (error) {
        console.error('[ERROR] Knowledge import failed:', error);
        res.status(500).json({ error: 'Knowledge import failed.' });
    }
});

router.post('/batch-import', upload.array('files', BATCH_IMPORT_FILE_LIMIT), async (req, res) => {
    const files = req.files || [];
    const sourceType = req.body.source_type || req.body.sourceType || 'case';
    const category = req.body.category || '';
    const sourceUrl = req.body.source_url || req.body.sourceUrl || '';

    if (files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded for batch import.' });
    }

    try {
        const totals = {
            imported: 0,
            chunks: 0,
            deduped: 0,
            files: 0,
            failed: [],
            vectorStore: 'sqlite-fallback',
        };
        let entries = [];

        const flushEntries = async () => {
            if (entries.length === 0) return;
            const result = await importKnowledgeEntries(entries);
            totals.imported += result.imported || 0;
            totals.chunks += result.chunks || 0;
            totals.deduped += result.deduped || 0;
            totals.vectorStore = result.vectorStore || totals.vectorStore;
            entries = [];
        };

        for (const file of files) {
            const sourceName = Buffer.from(file.originalname, 'latin1').toString('utf8');
            try {
                if (sourceType === 'law' && path.extname(file.originalname).toLowerCase() === '.md') {
                    entries.push(...parseLegalMarkdownFile(file.path, {
                        sourceFile: sourceName,
                        sourceUrl,
                    }));
                } else {
                    const content = await extractTextFromFile(file.path);
                    entries.push({
                        source_type: sourceType,
                        title: req.body.title || sourceName,
                        category,
                        source_name: sourceName,
                        source_url: sourceUrl,
                        content,
                        metadata: {
                            original_filename: sourceName,
                            imported_by: 'batch-import',
                        },
                    });
                }
                totals.files += 1;
                if (entries.length >= BATCH_IMPORT_ENTRY_SIZE) {
                    await flushEntries();
                }
            } catch (error) {
                totals.failed.push({ file: sourceName, error: error.message });
            }
        }
        await flushEntries();
        res.status(totals.failed.length ? 207 : 201).json(totals);
    } catch (error) {
        console.error('[ERROR] Knowledge batch import failed:', error);
        res.status(500).json({ error: 'Knowledge batch import failed.' });
    } finally {
        for (const file of files) {
            fs.promises.unlink(file.path).catch(() => {});
        }
    }
});

router.delete('/', async (req, res) => {
    try {
        const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
        const sourceIds = Array.isArray(req.body?.source_ids || req.body?.sourceIds)
            ? (req.body.source_ids || req.body.sourceIds).filter(Boolean)
            : [];
        const sourceType = String(req.body?.source_type || req.body?.sourceType || '').trim();
        const title = String(req.body?.title || '').trim();
        const result = await deleteKnowledgeDocuments({ ids, sourceIds, sourceType, title });
        res.json(result);
    } catch (error) {
        console.error('[ERROR] Knowledge delete failed:', error);
        res.status(400).json({ error: error.message || 'Knowledge delete failed.' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid knowledge id.' });
        const result = await deleteKnowledgeDocuments({ ids: [id] });
        res.json(result);
    } catch (error) {
        console.error('[ERROR] Knowledge delete by id failed:', error);
        res.status(400).json({ error: error.message || 'Knowledge delete failed.' });
    }
});

// 向量数据库状态查询
router.get('/vector-status', async (req, res) => {
    try {
        const lawCount = await db('vector_documents').where({ source_type: 'law' }).count({ count: '*' }).first();
        const caseCount = await db('vector_documents').where({ source_type: 'case' }).count({ count: '*' }).first();
        const totalCount = await db('vector_documents').count({ count: '*' }).first();
        const count = Number(totalCount?.count || 0);
        res.json({
            hasData: count > 0,
            lawCount: Number(lawCount?.count || 0),
            caseCount: Number(caseCount?.count || 0),
            totalCount: count,
        });
    } catch (error) {
        res.status(500).json({ error: `查询向量数据库状态失败: ${error.message}` });
    }
});

// 重建向量数据库（SSE 流式返回进度）
router.post('/rebuild', async (req, res) => {
    // 设置 SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    // 异步发送 SSE 事件，yield 事件循环确保数据立即推送到客户端
    const sendEvent = async (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        // 让出事件循环，允许 Node.js 将缓冲区的数据刷新到网络
        await new Promise((resolve) => setImmediate(resolve));
    };

    try {
        console.log('[Knowledge] Rebuild vector database started...');

        // 1. 清空现有数据
        await sendEvent({ phase: 'clearing', message: '正在清空现有向量数据...' });
        const clearResult = await clearAllVectorDocuments();
        console.log(`[Knowledge] Cleared ${clearResult.deleted} existing vector documents.`);
        await sendEvent({ phase: 'clearing_done', cleared: clearResult.deleted });

        // 2. Seed 法条
        await sendEvent({ phase: 'law_start', message: '开始导入法条数据...' });
        const lawResult = await seedLawsFromMarkdown(async (progress) => {
            await sendEvent({
                phase: 'law',
                current: progress.current,
                total: progress.total,
                fileName: progress.fileName,
                chunks: progress.chunks,
            });
        });
        await sendEvent({ phase: 'law_done', result: lawResult });

        // 3. Seed 案例
        await sendEvent({ phase: 'case_start', message: '开始导入案例数据...' });
        const caseResult = await seedCasesFromJson(async (progress) => {
            await sendEvent({
                phase: 'case',
                current: progress.current,
                total: progress.total,
                fileName: progress.fileName,
                chunks: progress.chunks,
            });
        });
        await sendEvent({ phase: 'case_done', result: caseResult });

        // 4. 完成
        const summary = {
            phase: 'complete',
            message: '向量数据库重建完成',
            cleared: clearResult.deleted,
            law: lawResult,
            case: caseResult,
        };
        console.log('[Knowledge] Rebuild vector database completed.');
        await sendEvent(summary);
        res.end();
    } catch (error) {
        console.error('[ERROR] Knowledge rebuild failed:', error);
        await sendEvent({ phase: 'error', message: `向量数据库重建失败: ${error.message}` });
        res.end();
    }
});

// 同步法律版本:支持传入文件路径(filePath)或直接传入 Markdown 内容(title + markdown)
router.post('/laws/sync', async (req, res) => {
    const { filePath, title, markdown } = req.body || {};
    let tmpFilePath = null;
    try {
        let targetPath;
        if (filePath) {
            targetPath = filePath;
        } else if (markdown) {
            // 把 markdown 写入临时文件,同步完成后删除
            const tmpName = `law-sync-${Date.now()}-${Math.random().toString(36).slice(2)}.md`;
            tmpFilePath = path.join(os.tmpdir(), tmpName);
            fs.writeFileSync(tmpFilePath, markdown, 'utf8');
            targetPath = tmpFilePath;
        } else {
            return res.status(400).json({ success: false, error: '需提供 filePath 或 markdown 参数' });
        }

        const options = title ? { title } : {};
        const data = await lawSync.syncLawFromMarkdown(targetPath, options);
        res.json({ success: true, data });
    } catch (error) {
        console.error('[ERROR] Law sync failed:', error);
        res.status(500).json({ success: false, error: error.message || 'Law sync failed.' });
    } finally {
        // 临时文件用完即删
        if (tmpFilePath) {
            try {
                fs.unlinkSync(tmpFilePath);
            } catch (e) {
                /* 忽略删除失败 */
            }
        }
    }
});

// 查询某法律的版本时间线(必填 title)
router.get('/laws/versions', async (req, res) => {
    const title = String(req.query.title || '').trim();
    if (!title) {
        return res.status(400).json({ success: false, error: 'title 参数必填' });
    }
    try {
        const data = await lawSync.getLawVersionComparison(title);
        res.json({ success: true, data });
    } catch (error) {
        console.error('[ERROR] Law versions query failed:', error);
        res.status(500).json({ success: false, error: error.message || 'Law versions query failed.' });
    }
});

// 返回所有法律的当前版本列表(仅 status='现行',按 title 去重取 effective_date 最新的一条)
router.get('/laws', async (req, res) => {
    try {
        const currentVersions = await db('law_versions')
            .where('status', '现行')
            .select('id', 'title', 'version_label', 'effective_date', 'status', 'synced_at')
            .orderBy('title');
        // 同一 title 理论上只应有一条现行记录,兼容处理:按 title 分组取 effective_date 最新
        const latestByTitle = new Map();
        for (const row of currentVersions) {
            const existing = latestByTitle.get(row.title);
            if (!existing || (row.effective_date || '') > (existing.effective_date || '')) {
                latestByTitle.set(row.title, row);
            }
        }
        const data = Array.from(latestByTitle.values()).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        res.json({ success: true, data });
    } catch (error) {
        console.error('[ERROR] Law list failed:', error);
        res.status(500).json({ success: false, error: error.message || 'Law list failed.' });
    }
});

module.exports = router;
