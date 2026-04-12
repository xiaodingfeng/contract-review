const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');
const {
    importKnowledgeEntries,
    searchVectorDocuments,
    deleteKnowledgeDocuments,
    listKnowledgeDocuments,
} = require('../services/vectorStore');
const { parseLegalMarkdown, parseLegalMarkdownFile } = require('../services/legalMarkdownParser');

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

module.exports = router;
