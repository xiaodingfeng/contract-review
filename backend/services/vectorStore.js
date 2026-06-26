const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../database');
const { EMBEDDING_DIM, embedText, embedTexts, ensureEmbeddingReady, rerankDocuments } = require('./embeddingClient');
const { parseLegalMarkdownFile } = require('./legalMarkdownParser');
const { parseCaseJsonDocument } = require('./caseJsonParser');

let MilvusClient;
let DataType;
let MetricType;
try {
    ({ MilvusClient, DataType, MetricType } = require('@zilliz/milvus2-sdk-node'));
} catch (error) {
    console.warn('[Milvus] SDK not installed. Relational vector fallback will be used.');
}

const lawsMarkdownDir = path.join(__dirname, '..', 'data', 'laws');
const caseJsonDir = path.join(__dirname, '..', 'data', 'candidate_55192');
const COLLECTION_NAME = process.env.MILVUS_COLLECTION || 'contract_review_knowledge';
const VECTOR_FIELD = 'embedding';
const DEFAULT_LAW_SEED_DIRS = ['社会法', '民法典'];
const KNOWLEDGE_SEED_TYPES = String(process.env.KNOWLEDGE_SEED_TYPES || 'law,case')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
const LAW_SEED_FILE_BATCH_SIZE = Math.max(1, Number(process.env.LAW_SEED_FILE_BATCH_SIZE || 20));
const CASE_SEED_LIMIT = Math.max(0, Number(process.env.CASE_SEED_LIMIT || 10));
let milvusClientPromise = null;
let milvusReady = false;
const MILVUS_CONNECT_TIMEOUT_MS = Number(process.env.MILVUS_CONNECT_TIMEOUT_MS || 3000);

const normalizeText = (text) => String(text || '').replace(/\s+/g, ' ').trim();

const listConfiguredLawDirs = () => {
    const configured = String(process.env.LAW_SEED_DIRS || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    const dirs = configured.length ? configured : DEFAULT_LAW_SEED_DIRS;
    return dirs.map((item) => path.isAbsolute(item) ? item : path.join(lawsMarkdownDir, item));
};

const listMarkdownFiles = (dirs) => {
    const rootDirs = Array.isArray(dirs) ? dirs : [dirs];
    const files = [];
    const walk = (currentDir) => {
        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
                continue;
            }
            if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
                files.push(fullPath);
            }
        }
    };
    for (const dir of rootDirs) {
        if (fs.existsSync(dir)) walk(dir);
    }
    return files
        .filter((filePath) => {
            const filename = path.basename(filePath).toLowerCase();
            return filename !== '_index.md' && filename !== '法律法规模版.md';
        })
        .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
};

const listCaseJsonFiles = () => {
    const dir = process.env.CASE_SEED_DIR
        ? (path.isAbsolute(process.env.CASE_SEED_DIR) ? process.env.CASE_SEED_DIR : path.join(__dirname, '..', process.env.CASE_SEED_DIR))
        : caseJsonDir;
    if (!fs.existsSync(dir) || CASE_SEED_LIMIT <= 0) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
        .map((entry) => path.join(dir, entry.name))
        .sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'zh-Hans-CN'))
        .slice(0, CASE_SEED_LIMIT);
};

const plainMarkdownContent = (markdown) => String(markdown || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();

const fallbackLawEntryFromFile = (filePath) => {
    const markdown = fs.readFileSync(filePath, 'utf8');
    const cleaned = plainMarkdownContent(markdown);
    if (!cleaned) return null;
    const relativePath = path.relative(lawsMarkdownDir, filePath);
    const title = cleaned.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
        || path.basename(filePath, path.extname(filePath));
    return {
        source_type: 'law',
        source_id: `law-file:${crypto.createHash('sha256').update(`${relativePath}|${cleaned}`).digest('hex')}`,
        title,
        category: path.dirname(relativePath).replace(/[\\/]/g, ' / '),
        source_name: title,
        content: cleaned,
        metadata: {
            source_file: relativePath,
            parser: 'plain-markdown-fallback',
        },
    };
};

const sourceHash = (parts) => crypto
    .createHash('sha256')
    .update(parts.map((part) => String(part || '')).join('|'))
    .digest('hex');

const escapeExpr = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const splitTextIntoChunks = (text, { maxChars = 900, overlap = 120 } = {}) => {
    const normalized = normalizeText(text);
    if (!normalized) return [];

    const paragraphs = normalized
        .split(/(?:\r?\n)+|(?<=[。！？；;.!?])\s*/g)
        .map((item) => item.trim())
        .filter(Boolean);
    const chunks = [];
    let current = '';

    const pushCurrent = () => {
        if (!current.trim()) return;
        chunks.push(current.trim());
        current = current.slice(Math.max(0, current.length - overlap));
    };

    for (const paragraph of paragraphs.length ? paragraphs : [normalized]) {
        if (paragraph.length > maxChars) {
            pushCurrent();
            for (let i = 0; i < paragraph.length; i += maxChars - overlap) {
                chunks.push(paragraph.slice(i, i + maxChars).trim());
            }
            current = '';
            continue;
        }
        if ((current + paragraph).length > maxChars) pushCurrent();
        current = current ? `${current}\n${paragraph}` : paragraph;
    }
    pushCurrent();

    return chunks.filter((chunk) => chunk.length >= 20);
};

// 按段落拆分文本（不跨段落合并），每个段落作为独立 query 保留完整语义
// 超长段落按句末标点二次拆分，同段落内的句子可组合到 maxChars 以内（语义连贯）
// minChars 以下的碎片直接丢弃，避免无意义 query 稀释检索
const splitIntoParagraphs = (text, { maxChars = 500, minChars = 5 } = {}) => {
    // 不能用 normalizeText：它会把 \r\n 折成空格，导致段落边界丢失、整篇被合并成一段
    // 只在段落内部折叠空格/制表符，保留 \r?\n 作为段落分隔
    const raw = String(text || '');
    if (!raw.trim()) return [];

    const paragraphs = raw
        .split(/(?:\r?\n)+/g)
        .map((p) => p.replace(/[ \t]+/g, ' ').trim())
        .filter(Boolean);

    const result = [];
    for (const para of paragraphs.length ? paragraphs : [raw.trim()]) {
        if (para.length <= maxChars) {
            result.push(para);
            continue;
        }
        // 超长段落按句末标点拆分，同段落内句子组合到 maxChars 以内
        const sentences = para.split(/(?<=[。！？；;.!?])\s*/g).map((s) => s.trim()).filter(Boolean);
        let buf = '';
        for (const sentence of sentences.length ? sentences : [para]) {
            if (sentence.length > maxChars) {
                if (buf) { result.push(buf); buf = ''; }
                result.push(sentence); // 超长单句保持原样，交给 embedding 模型截断
                continue;
            }
            if ((buf + sentence).length > maxChars) {
                if (buf) result.push(buf);
                buf = sentence;
            } else {
                buf = buf ? `${buf}${sentence}` : sentence;
            }
        }
        if (buf) result.push(buf);
    }
    return result.filter((p) => p.length >= minChars);
};

// 通道 B「合同内容」专用切分：每个 \n 一段，相邻 groupSize 段合并为一个 chunk
// 目的：把"每行一段"的细粒度按语义聚合成块，既保留合同自然结构，
// 又避免每行一个 query 产生大量噪声检索；maxChars 防止单块过长被 embedding 截断
const splitIntoParagraphGroups = (text, { groupSize = 5, maxChars = 500, minChars = 5 } = {}) => {
    const raw = String(text || '');
    if (!raw.trim()) return [];

    const paragraphs = raw
        .split(/(?:\r?\n)+/g)
        .map((p) => p.replace(/[ \t]+/g, ' ').trim())
        .filter(Boolean);
    if (paragraphs.length === 0) return [];

    const groups = [];
    let buf = [];
    let bufLen = 0;
    const flush = () => {
        if (buf.length === 0) return;
        const chunk = buf.join(' ');
        if (chunk.length >= minChars) groups.push(chunk);
        buf = [];
        bufLen = 0;
    };

    for (const para of paragraphs) {
        // 达到 groupSize 或加入后超过 maxChars，先 flush（保证块不致过长）
        if (buf.length >= groupSize || (bufLen + para.length + 1) > maxChars) {
            flush();
        }
        buf.push(para);
        bufLen += para.length + 1;
        // 单段本身超 maxChars，单独成块（不再与相邻段合并）
        if (para.length > maxChars) flush();
    }
    flush();
    return groups;
};

const getMilvusClient = async () => {
    const vectorStore = String(process.env.VECTOR_STORE || '').toLowerCase();
    if (!MilvusClient || ['sqlite', 'postgres', 'relational'].includes(vectorStore)) return null;
    if (!process.env.MILVUS_ADDRESS) return null;
    if (!milvusClientPromise) {
        milvusClientPromise = (async () => {
            const client = new MilvusClient({
                address: process.env.MILVUS_ADDRESS,
                username: process.env.MILVUS_USERNAME || undefined,
                password: process.env.MILVUS_PASSWORD || undefined,
                token: process.env.MILVUS_TOKEN || undefined,
                database: process.env.MILVUS_DATABASE || undefined,
                ssl: String(process.env.MILVUS_SSL || '').toLowerCase() === 'true',
            });
            await Promise.race([
                client.connectPromise,
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(`Milvus connect timeout after ${MILVUS_CONNECT_TIMEOUT_MS}ms`)), MILVUS_CONNECT_TIMEOUT_MS);
                }),
            ]);
            return client;
        })();
    }
    return milvusClientPromise;
};

const ensureRelationalVectorTable = async () => {
    const exists = await db.schema.hasTable('vector_documents');
    if (!exists) {
        await db.schema.createTable('vector_documents', (table) => {
            table.increments('id').primary();
            table.string('source_type').notNullable().index();
            table.string('source_id').notNullable().unique();
            table.string('title').notNullable();
            table.string('category');
            table.string('clause_id');
            table.string('source_name');
            table.string('source_url');
            table.integer('chunk_index').defaultTo(0);
            table.string('content_hash').index();
            table.text('content').notNullable();
            table.text('metadata');
            table.text('embedding').notNullable();
            table.timestamps(true, true);
        });
        return;
    }

    const columns = await db('vector_documents').columnInfo();
    const addColumn = async (name, callback) => {
        if (!columns[name]) {
            await db.schema.table('vector_documents', callback);
        }
    };
    await addColumn('source_name', (table) => table.string('source_name'));
    await addColumn('source_url', (table) => table.string('source_url'));
    await addColumn('chunk_index', (table) => table.integer('chunk_index').defaultTo(0));
    await addColumn('content_hash', (table) => table.string('content_hash').index());
};

const ensureMilvusCollection = async () => {
    try {
        const client = await getMilvusClient();
        if (!client) return false;
        const exists = await client.hasCollection({ collection_name: COLLECTION_NAME });
        const hasCollection = exists?.value === true;
        if (!hasCollection) {
            await client.createCollection({
                collection_name: COLLECTION_NAME,
                fields: [
                    { name: 'id', data_type: DataType.Int64, is_primary_key: true, autoID: true },
                    { name: 'source_id', data_type: DataType.VarChar, max_length: 512 },
                    { name: 'source_type', data_type: DataType.VarChar, max_length: 64 },
                    { name: 'title', data_type: DataType.VarChar, max_length: 512 },
                    { name: 'category', data_type: DataType.VarChar, max_length: 256 },
                    { name: 'clause_id', data_type: DataType.VarChar, max_length: 128 },
                    { name: 'source_name', data_type: DataType.VarChar, max_length: 512 },
                    { name: 'source_url', data_type: DataType.VarChar, max_length: 1024 },
                    { name: 'chunk_index', data_type: DataType.Int64 },
                    { name: 'content_hash', data_type: DataType.VarChar, max_length: 128 },
                    { name: 'content', data_type: DataType.VarChar, max_length: 4096 },
                    { name: VECTOR_FIELD, data_type: DataType.FloatVector, dim: EMBEDDING_DIM },
                ],
                index_params: [
                    {
                        field_name: VECTOR_FIELD,
                        index_type: 'HNSW',
                        metric_type: MetricType.COSINE,
                        params: { M: 16, efConstruction: 200 },
                    },
                ],
                enable_dynamic_field: true,
            });
        }
        await client.loadCollection({ collection_name: COLLECTION_NAME });
        milvusReady = true;
        return true;
    } catch (error) {
        milvusClientPromise = null;
        milvusReady = false;
        console.warn(`[Milvus] Collection init failed: ${error.message}. Relational vector fallback will be used.`);
        return false;
    }
};

const ensureVectorStore = async () => {
    await ensureRelationalVectorTable();
    await ensureMilvusCollection();
};

const toMetadataObject = (metadata) => {
    if (!metadata) return {};
    if (typeof metadata === 'string') {
        try {
            return JSON.parse(metadata);
        } catch {
            return {};
        }
    }
    return metadata;
};

const toVectorDocumentRows = async (entry) => {
    const sourceType = entry.sourceType || entry.source_type || entry.type || 'law';
    const title = entry.title || entry.source_name || '未命名知识文档';
    const category = entry.category || '';
    const sourceName = entry.source_name || entry.sourceName || title;
    const sourceUrl = entry.source_url || entry.sourceUrl || '';
    const metadata = toMetadataObject(entry.metadata);
    const chunks = entry.chunks || splitTextIntoChunks(entry.content || '');
    const textsForEmbedding = chunks.map((chunk, index) => `${title}\n${category}\n${entry.clauseId || entry.clause_id || ''}\n${chunk}`);
    const embeddings = await embedTexts(textsForEmbedding);

    return chunks.map((chunk, index) => {
        const clauseId = String(entry.clauseId || entry.clause_id || entry.id || index + 1);
        const contentHash = sourceHash([sourceType, title, category, clauseId, chunk]);
        const sourceId = entry.sourceId || entry.source_id || `${sourceType}:${sourceHash([title, category, clauseId, contentHash])}`;
        return {
            source_type: sourceType,
            source_id: chunks.length > 1 ? `${sourceId}:chunk:${index}` : sourceId,
            title,
            category,
            clause_id: chunks.length > 1 ? `${clauseId}-${index + 1}` : clauseId,
            source_name: sourceName,
            source_url: sourceUrl,
            chunk_index: index,
            content_hash: contentHash,
            content: chunk,
            metadata: JSON.stringify({ ...metadata, original_source_id: sourceId }),
            embedding: embeddings[index],
        };
    });
};

const upsertRelationalRow = async (row) => {
    const payload = {
        ...row,
        embedding: JSON.stringify(row.embedding),
        updated_at: db.fn.now(),
    };
    const duplicate = await db('vector_documents').where({ content_hash: row.content_hash }).first();
    if (duplicate) {
        await db('vector_documents').where({ id: duplicate.id }).update(payload);
        return { id: duplicate.id, deduped: true };
    }
    const existing = await db('vector_documents').where({ source_id: row.source_id }).first();
    if (existing) {
        await db('vector_documents').where({ id: existing.id }).update(payload);
        return { id: existing.id, deduped: false };
    }
    const [inserted] = await db('vector_documents').insert(payload).returning('id');
    const id = typeof inserted === 'object' ? inserted.id : inserted;
    return { id, deduped: false };
};

const upsertMilvusRows = async (rows) => {
    if (rows.length === 0) return false;
    if (!milvusReady) return false;
    const client = await getMilvusClient();
    if (!client) return false;
    try {
        await deleteMilvusRows(rows);
        await client.insert({
            collection_name: COLLECTION_NAME,
            data: rows.map((row) => ({
                source_id: row.source_id,
                source_type: row.source_type,
                title: row.title.slice(0, 512),
                category: String(row.category || '').slice(0, 256),
                clause_id: String(row.clause_id || '').slice(0, 128),
                source_name: String(row.source_name || '').slice(0, 512),
                source_url: String(row.source_url || '').slice(0, 1024),
                chunk_index: Number(row.chunk_index || 0),
                content_hash: row.content_hash,
                content: row.content.slice(0, 4096),
                [VECTOR_FIELD]: row.embedding,
            })),
        });
        await client.flush({ collection_names: [COLLECTION_NAME] });
        return true;
    } catch (error) {
        console.warn(`[Milvus] Upsert failed: ${error.message}. Relational fallback still contains metadata and vectors.`);
        return false;
    }
};

const hasMilvusRows = async (sourceType) => {
    if (!milvusReady) return false;
    const client = await getMilvusClient();
    if (!client) return false;
    try {
        const response = await client.query({
            collection_name: COLLECTION_NAME,
            filter: `source_type == "${escapeExpr(sourceType)}"`,
            output_fields: ['source_id'],
            limit: 1,
        });
        return (response.data || []).length > 0;
    } catch (error) {
        console.warn(`[Milvus] Count check failed: ${error.message}. Relational fallback will be used.`);
        return false;
    }
};

const syncRelationalRowsToMilvus = async (sourceType) => {
    if (!milvusReady) return { synced: 0, vectorStore: 'relational-fallback' };
    let synced = 0;
    let lastId = 0;
    while (true) {
        const rows = await db('vector_documents')
            .where({ source_type: sourceType })
            .andWhere('id', '>', lastId)
            .orderBy('id', 'asc')
            .limit(200)
            .select('*');
        if (rows.length === 0) break;
        lastId = rows[rows.length - 1].id;
        const batch = rows.map((row) => ({
            ...row,
            embedding: JSON.parse(row.embedding || '[]'),
        }));
        const ok = await upsertMilvusRows(batch);
        if (!ok) break;
        synced += batch.length;
    }
    return { synced, vectorStore: milvusReady ? 'milvus' : 'relational-fallback' };
};

const importKnowledgeEntries = async (entries) => {
    await ensureVectorStore();
    let imported = 0;
    let chunks = 0;
    let deduped = 0;
    let milvusRowsBuffer = [];

    const flushMilvusRows = async () => {
        if (milvusRowsBuffer.length === 0) return;
        await upsertMilvusRows(milvusRowsBuffer);
        milvusRowsBuffer = [];
    };

    for (const entry of entries) {
        const rows = [];
        if (Array.isArray(entry.key_clauses)) {
            for (const clause of entry.key_clauses) {
                rows.push(...await toVectorDocumentRows({
                    ...entry,
                    content: clause.content,
                    clauseId: clause.id,
                    sourceId: entry.source_id || `${entry.source_type || entry.type || 'law'}:${entry.title}:${clause.id}`,
                    metadata: { ...(entry.metadata || {}), law: entry.title, category: entry.category },
                }));
            }
        } else {
            rows.push(...await toVectorDocumentRows(entry));
        }

        const uniqueRows = [];
        const seen = new Set();
        for (const row of rows) {
            if (seen.has(row.content_hash)) {
                deduped += 1;
                continue;
            }
            seen.add(row.content_hash);
            uniqueRows.push(row);
        }

        for (const row of uniqueRows) {
            const result = await upsertRelationalRow(row);
            if (result.deduped) deduped += 1;
        }
        milvusRowsBuffer.push(...uniqueRows);
        if (milvusRowsBuffer.length >= 200) {
            await flushMilvusRows();
        }
        imported += 1;
        chunks += uniqueRows.length;
    }
    await flushMilvusRows();

    return { imported, chunks, deduped, vectorStore: milvusReady ? 'milvus' : 'relational-fallback' };
};

const seedLawsFromMarkdown = async (onProgress) => {
    if (!KNOWLEDGE_SEED_TYPES.includes('law')) {
        console.log('[DB Init] Law seeding disabled by KNOWLEDGE_SEED_TYPES.');
        return { skipped: true, disabled: true };
    }
    await ensureVectorStore();
    const embeddingReady = await ensureEmbeddingReady();
    if (!embeddingReady) {
        throw new Error(`Embedding model dimension mismatch. Expected ${EMBEDDING_DIM}.`);
    }

    const existingLawCount = await db('vector_documents').where({ source_type: 'law' }).count({ count: '*' }).first();
    const forceReseed = String(process.env.FORCE_RESEED_LAWS || '').toLowerCase() === 'true';
    if (Number(existingLawCount?.count || 0) > 0 && !forceReseed) {
        if (milvusReady && !await hasMilvusRows('law')) {
            const synced = await syncRelationalRowsToMilvus('law');
            console.log(`[DB Init] Relational law vectors exist; synced ${synced.synced} rows back to Milvus.`);
            return { skipped: true, existing: Number(existingLawCount?.count || 0), ...synced };
        }
        console.log('[DB Init] Law vector index already contains data. Skipping startup reseed.');
        return { skipped: true, existing: Number(existingLawCount?.count || 0) };
    }

    const seedDirs = listConfiguredLawDirs();
    const files = listMarkdownFiles(seedDirs);
    if (files.length === 0) {
        console.warn(`[DB Init] No law markdown files found under ${seedDirs.join(', ')}.`);
        return { imported: 0, chunks: 0, files: 0 };
    }

    if (forceReseed) {
        await deleteKnowledgeDocuments({ sourceType: 'law' });
    }

    const totals = { imported: 0, chunks: 0, deduped: 0, files: 0, failed: 0, vectorStore: milvusReady ? 'milvus' : 'relational-fallback' };
    let fileCounter = 0;
    for (let i = 0; i < files.length; i += LAW_SEED_FILE_BATCH_SIZE) {
        const batch = files.slice(i, i + LAW_SEED_FILE_BATCH_SIZE);
        const entries = [];
        for (const filePath of batch) {
            const sourceFile = path.relative(path.join(__dirname, '..'), filePath);
            const fileName = path.basename(filePath);
            try {
                const parsed = parseLegalMarkdownFile(filePath, { sourceFile });
                if (parsed.length > 0) {
                    entries.push(...parsed);
                } else {
                    const fallback = fallbackLawEntryFromFile(filePath);
                    if (fallback) entries.push(fallback);
                }
                totals.files += 1;
            } catch (error) {
                totals.failed += 1;
                console.warn(`[DB Init] Failed to parse law markdown ${sourceFile}: ${error.message}`);
            }
            // 上报单文件进度
            fileCounter += 1;
            if (onProgress) {
                await onProgress({
                    phase: 'law',
                    current: fileCounter,
                    total: files.length,
                    fileName,
                    chunks: totals.chunks,
                });
            }
        }
        if (entries.length > 0) {
            const result = await importKnowledgeEntries(entries);
            totals.imported += result.imported || 0;
            totals.chunks += result.chunks || 0;
            totals.deduped += result.deduped || 0;
            totals.vectorStore = result.vectorStore || totals.vectorStore;
        }
        console.log(`[DB Init] Law seed progress: ${Math.min(i + batch.length, files.length)}/${files.length} files, ${totals.chunks} chunks.`);
    }

    return totals;
};

const seedCasesFromJson = async (onProgress) => {
    if (!KNOWLEDGE_SEED_TYPES.includes('case')) {
        console.log('[DB Init] Case seeding disabled by KNOWLEDGE_SEED_TYPES.');
        return { skipped: true, disabled: true };
    }
    await ensureVectorStore();
    const embeddingReady = await ensureEmbeddingReady();
    if (!embeddingReady) {
        throw new Error(`Embedding model dimension mismatch. Expected ${EMBEDDING_DIM}.`);
    }

    const existingCaseCount = await db('vector_documents').where({ source_type: 'case' }).count({ count: '*' }).first();
    const forceReseed = String(process.env.FORCE_RESEED_CASES || '').toLowerCase() === 'true';
    if (Number(existingCaseCount?.count || 0) > 0 && !forceReseed) {
        if (milvusReady && !await hasMilvusRows('case')) {
            const synced = await syncRelationalRowsToMilvus('case');
            console.log(`[DB Init] Relational case vectors exist; synced ${synced.synced} rows back to Milvus.`);
            return { skipped: true, existing: Number(existingCaseCount?.count || 0), ...synced };
        }
        console.log('[DB Init] Case vector index already contains data. Skipping startup reseed.');
        return { skipped: true, existing: Number(existingCaseCount?.count || 0) };
    }

    const files = listCaseJsonFiles();
    if (files.length === 0) {
        console.warn(`[DB Init] No case JSON files found under ${process.env.CASE_SEED_DIR || caseJsonDir}.`);
        return { imported: 0, chunks: 0, files: 0 };
    }

    if (forceReseed) {
        await deleteKnowledgeDocuments({ sourceType: 'case' });
    }

    const entries = [];
    const totals = { imported: 0, chunks: 0, deduped: 0, files: 0, failed: 0, vectorStore: milvusReady ? 'milvus' : 'relational-fallback' };
    for (let idx = 0; idx < files.length; idx += 1) {
        const filePath = files[idx];
        const sourceFile = path.relative(path.join(__dirname, '..'), filePath);
        const fileName = path.basename(filePath);
        try {
            const parsed = parseCaseJsonDocument(JSON.parse(fs.readFileSync(filePath, 'utf8')), { sourceFile });
            if (parsed) entries.push(parsed);
            totals.files += 1;
        } catch (error) {
            totals.failed += 1;
            console.warn(`[DB Init] Failed to parse case JSON ${sourceFile}: ${error.message}`);
        }
        if (onProgress) {
            await onProgress({
                phase: 'case',
                current: idx + 1,
                total: files.length,
                fileName,
                chunks: totals.chunks,
            });
        }
    }

    if (entries.length > 0) {
        const result = await importKnowledgeEntries(entries);
        totals.imported += result.imported || 0;
        totals.chunks += result.chunks || 0;
        totals.deduped += result.deduped || 0;
        totals.vectorStore = result.vectorStore || totals.vectorStore;
    }
    console.log(`[DB Init] Case seed finished: ${totals.files}/${files.length} files, ${totals.chunks} chunks.`);
    return totals;
};

const deleteMilvusRows = async (rows) => {
    if (!milvusReady || rows.length === 0) return false;
    const client = await getMilvusClient();
    if (!client) return false;

    try {
        const sourceIds = rows.map((row) => row.source_id).filter(Boolean);
        const contentHashes = rows.map((row) => row.content_hash).filter(Boolean);
        const sourceExpr = sourceIds.length
            ? `source_id in [${sourceIds.map((item) => `"${escapeExpr(item)}"`).join(',')}]`
            : '';
        const hashExpr = contentHashes.length
            ? `content_hash in [${contentHashes.map((item) => `"${escapeExpr(item)}"`).join(',')}]`
            : '';
        const filter = [sourceExpr, hashExpr].filter(Boolean).join(' or ');
        if (!filter) return false;

        await client.delete({ collection_name: COLLECTION_NAME, filter });
        await client.flush({ collection_names: [COLLECTION_NAME] });
        return true;
    } catch (error) {
        console.warn(`[Milvus] Delete failed: ${error.message}. SQLite metadata has been deleted.`);
        return false;
    }
};

const deleteKnowledgeDocuments = async ({ ids = [], sourceIds = [], sourceType = '', title = '' } = {}) => {
    await ensureVectorStore();
    let query = db('vector_documents');
    let hasFilter = false;

    if (ids.length > 0) {
        query = query.whereIn('id', ids);
        hasFilter = true;
    }
    if (sourceIds.length > 0) {
        query = query.whereIn('source_id', sourceIds);
        hasFilter = true;
    }
    if (sourceType) {
        query = query.where('source_type', sourceType);
        hasFilter = true;
    }
    if (title) {
        query = query.where('title', title);
        hasFilter = true;
    }
    if (!hasFilter) {
        throw new Error('At least one delete filter is required.');
    }

    const rows = await query.clone().select('id', 'source_id', 'content_hash');
    if (rows.length === 0) {
        return { deleted: 0, vectorStore: milvusReady ? 'milvus' : 'relational-fallback' };
    }
    await deleteMilvusRows(rows);
    await db('vector_documents').whereIn('id', rows.map((row) => row.id)).del();
    return { deleted: rows.length, vectorStore: milvusReady ? 'milvus' : 'relational-fallback' };
};

// 清空所有向量数据（用于重建），同时清空 SQLite 和 Milvus
const clearAllVectorDocuments = async () => {
    await ensureVectorStore();
    const rows = await db('vector_documents').select('id', 'source_id', 'content_hash');
    const deleted = rows.length;
    if (deleted > 0) {
        await deleteMilvusRows(rows);
        await db('vector_documents').del();
    }
    return { deleted, vectorStore: milvusReady ? 'milvus' : 'relational-fallback' };
};

const listKnowledgeDocuments = async ({
    page = 1,
    pageSize = 10,
    query = '',
    sourceType = '',
} = {}) => {
    await ensureVectorStore();
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 10));
    const offset = (safePage - 1) * safePageSize;
    const keyword = normalizeText(query);

    const applyFilters = (builder) => {
        if (sourceType) builder.where('source_type', sourceType);
        if (keyword) {
            builder.andWhere((nested) => {
                nested
                    .where('title', 'like', `%${keyword}%`)
                    .orWhere('category', 'like', `%${keyword}%`)
                    .orWhere('clause_id', 'like', `%${keyword}%`)
                    .orWhere('source_name', 'like', `%${keyword}%`)
                    .orWhere('content', 'like', `%${keyword}%`);
            });
        }
        return builder;
    };

    const totalRow = await applyFilters(db('vector_documents')).count({ total: '*' }).first();
    const rows = await applyFilters(db('vector_documents'))
        .select(
            'id',
            'source_type',
            'source_id',
            'title',
            'category',
            'clause_id',
            'source_name',
            'source_url',
            'chunk_index',
            'content_hash',
            'content',
            'metadata',
            'updated_at',
        )
        .orderBy('updated_at', 'desc')
        .limit(safePageSize)
        .offset(offset);

    return {
        page: safePage,
        pageSize: safePageSize,
        total: Number(totalRow?.total || 0),
        items: rows.map((row) => ({ ...row, metadata: toMetadataObject(row.metadata) })),
    };
};

const sqliteVectorSearch = async (query, queryVector, { limit, sourceTypes }) => {
    let rowsQuery = db('vector_documents');
    if (sourceTypes.length > 0) rowsQuery = rowsQuery.whereIn('source_type', sourceTypes);
    const rows = await rowsQuery.select('*');
    return rows
        .map((row) => {
            const embedding = JSON.parse(row.embedding || '[]');
            let score = 0;
            for (let i = 0; i < Math.min(queryVector.length, embedding.length); i += 1) {
                score += (queryVector[i] || 0) * (embedding[i] || 0);
            }
            return {
                id: row.id,
                source_type: row.source_type,
                source_id: row.source_id,
                title: row.title,
                category: row.category,
                clause_id: row.clause_id,
                source_name: row.source_name,
                source_url: row.source_url,
                chunk_index: row.chunk_index,
                content_hash: row.content_hash,
                content: row.content,
                metadata: toMetadataObject(row.metadata),
                score,
            };
        })
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
};

const tokenizeQuery = (query) => {
    const text = normalizeText(query).toLowerCase();
    const terms = text.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{2,}/g) || [];
    const stopwords = new Set(['合同', '条款', '风险', '审查', '问题', '建议', '相关', '依据', '法律', '法规']);
    return [...new Set(terms)]
        .filter((term) => !stopwords.has(term) && term.length <= 24)
        .slice(0, 16);
};

const keywordSearch = async (query, { limit, sourceTypes }) => {
    const terms = tokenizeQuery(query);
    if (terms.length === 0) return [];

    let rowsQuery = db('vector_documents');
    if (sourceTypes.length > 0) rowsQuery = rowsQuery.whereIn('source_type', sourceTypes);
    rowsQuery = rowsQuery.andWhere((nested) => {
        for (const term of terms) {
            nested
                .orWhere('title', 'like', `%${term}%`)
                .orWhere('category', 'like', `%${term}%`)
                .orWhere('clause_id', 'like', `%${term}%`)
                .orWhere('source_name', 'like', `%${term}%`)
                .orWhere('content', 'like', `%${term}%`);
        }
    });

    const rows = await rowsQuery.select('*').limit(limit * 8);
    return rows
        .map((row) => {
            const title = `${row.title || ''} ${row.category || ''} ${row.clause_id || ''} ${row.source_name || ''}`.toLowerCase();
            const content = String(row.content || '').toLowerCase();
            const score = terms.reduce((sum, term) => {
                const titleHits = title.includes(term) ? 0.15 : 0;
                const contentHits = content.includes(term) ? 0.05 : 0;
                return sum + titleHits + contentHits;
            }, 0);
            return {
                id: row.id,
                source_type: row.source_type,
                source_id: row.source_id,
                title: row.title,
                category: row.category,
                clause_id: row.clause_id,
                source_name: row.source_name,
                source_url: row.source_url,
                chunk_index: row.chunk_index,
                content_hash: row.content_hash,
                content: row.content,
                metadata: toMetadataObject(row.metadata),
                score,
                keyword_score: score,
            };
        })
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
};

const mergeSearchResults = (primary, secondary, limit) => {
    const byHash = new Map();
    for (const row of [...primary, ...secondary]) {
        const key = row.content_hash || row.source_id || row.id;
        const existing = byHash.get(key);
        if (!existing || Number(row.score || 0) + Number(row.keyword_score || 0) > Number(existing.score || 0) + Number(existing.keyword_score || 0)) {
            byHash.set(key, row);
        }
    }
    return [...byHash.values()]
        .sort((a, b) => (Number(b.score || 0) + Number(b.keyword_score || 0)) - (Number(a.score || 0) + Number(a.keyword_score || 0)))
        .slice(0, limit);
};

const milvusVectorSearch = async (queryVector, { limit, sourceTypes }) => {
    if (!milvusReady) return null;
    const client = await getMilvusClient();
    if (!client) return null;
    try {
        const filter = sourceTypes.length
            ? `source_type in [${sourceTypes.map((item) => `"${escapeExpr(item)}"`).join(',')}]`
            : undefined;
        const response = await client.search({
            collection_name: COLLECTION_NAME,
            data: [queryVector],
            anns_field: VECTOR_FIELD,
            limit,
            filter,
            output_fields: [
                'source_id',
                'source_type',
                'title',
                'category',
                'clause_id',
                'source_name',
                'source_url',
                'chunk_index',
                'content_hash',
                'content',
            ],
        });
        return (response.results || []).map((row) => ({
            id: row.id,
            source_type: row.source_type,
            source_id: row.source_id,
            title: row.title,
            category: row.category,
            clause_id: row.clause_id,
            source_name: row.source_name,
            source_url: row.source_url,
            chunk_index: row.chunk_index,
            content_hash: row.content_hash,
            content: row.content,
            metadata: {},
            score: row.score,
        }));
    } catch (error) {
        console.warn(`[Milvus] Search failed: ${error.message}. Falling back to relational vectors.`);
        return null;
    }
};

const searchVectorDocuments = async (query, { limit = 5, sourceTypes = [], rerank = true } = {}) => {
    await ensureVectorStore();
    const cleanQuery = normalizeText(query);
    const queryVector = await embedText(cleanQuery);
    const candidateLimit = Math.max(limit * 8, limit);
    let results = await milvusVectorSearch(queryVector, { limit: candidateLimit, sourceTypes });
    // Milvus 返回空数组时也回退到关系库（避免 Milvus 无数据但 SQLite 有数据时搜不到）
    if (!results || results.length === 0) {
        if (results && results.length === 0 && milvusReady) {
            console.log('[Vector Search] Milvus returned 0 results, falling back to relational vectors.');
        }
        results = await sqliteVectorSearch(cleanQuery, queryVector, { limit: candidateLimit, sourceTypes });
    }
    const keywordResults = await keywordSearch(cleanQuery, { limit: candidateLimit, sourceTypes });
    results = mergeSearchResults(results, keywordResults, candidateLimit);
    const reranked = rerank ? await rerankDocuments(cleanQuery, results, limit) : results.slice(0, limit);
    return reranked.slice(0, limit);
};

// 知识库检索 rerank 阈值：只对 rerank_score 生效；rerank 不可用时（无 rerank_score）不过滤
// 设为 0 可关闭阈值过滤；未配置环境变量时默认 0.6
const DEFAULT_SCORE_THRESHOLD = (() => {
    const v = Number(process.env.KNOWLEDGE_SCORE_THRESHOLD);
    return Number.isFinite(v) ? v : 0.6;
})();

// 多 query 拆分检索：对每个子 query 独立召回 + rerank，再按 content_hash 去重融合
// 适用于"合同类型 + 审查点 + 合同正文段落"这类多意图场景，避免长文本稀释聚焦词信号
const searchVectorDocumentsMulti = async (queries, {
    limit = 8,
    sourceTypes = [],
    rerank = true,
    scoreThreshold = DEFAULT_SCORE_THRESHOLD,
    perQueryLimit = 2,
} = {}) => {
    const cleanQueries = (Array.isArray(queries) ? queries : [queries])
        .map((q) => normalizeText(q))
        .filter((q) => q && q.length >= 5);
    if (cleanQueries.length === 0) return [];
    const filterByThreshold = (items) => {
        if (scoreThreshold <= 0) return items;
        return items.filter((item) => {
            if (item.rerank_score === undefined || item.rerank_score === null) return true;
            return item.rerank_score >= scoreThreshold;
        });
    };

    if (cleanQueries.length === 1) {
        const results = await searchVectorDocuments(cleanQueries[0], { limit, sourceTypes, rerank });
        return filterByThreshold(results).slice(0, limit);
    }

    // 多 query 时每条少取一些，靠融合补足；perQueryLimit 由调用方按通道配置
    const perQueryResults = await Promise.all(
        cleanQueries.map((q) => searchVectorDocuments(q, {
            limit: perQueryLimit,
            sourceTypes,
            rerank,
        })),
    );
    // 融合：按 content_hash/source_id 去重，保留最高 rerank_score（或 score 兜底）
    // 1. 先过滤掉低于 KNOWLEDGE_SCORE_THRESHOLD 的项；每个 cleanQuery 贡献一条最高分的 above-threshold 项
    //    （已被其他 query 选中的跳过，保证多样性；某 query 无 above-threshold 项则跳过）
    // 2. 如果 Phase 1 超出 limit，按实际取 top limit return phase1;
    // 3. 如果 Phase 1 不足 limit，从剩余项（含 below-threshold）去重后按分数补充

    const getKey = (item) => item.content_hash || item.source_id || item.id;
    const scoreOf = (item) => item.rerank_score ?? item.score ?? 0;
    const sortByScoreDesc = (a, b) => scoreOf(b) - scoreOf(a);
    const isAboveThreshold = (item) => {
        if (scoreThreshold <= 0) return true;
        if (item.rerank_score === undefined || item.rerank_score === null) return true;
        return item.rerank_score >= scoreThreshold;
    };

    // Phase 1：每个 cleanQuery 贡献一条最高分的 above-threshold 项（已被选中的跳过）
    const phase1 = [];
    const usedKeys = new Set();
    perQueryResults.forEach((results, queryIndex) => {
        const best = results
            .filter((item) => {
                if (!isAboveThreshold(item)) return false;
                const key = getKey(item);
                return !key || !usedKeys.has(key);
            })
            .sort(sortByScoreDesc)[0];
        if (!best) return; // 该 query 无 above-threshold 可用项，跳过
        const key = getKey(best);
        if (key) usedKeys.add(key);
        phase1.push({ ...best, matched_query_index: queryIndex });
    });
    phase1.sort(sortByScoreDesc);

    // 超出 limit 直接截断
    if (phase1.length >= limit) {
        return phase1.slice(0, limit);
    }
    // Phase 2：不足 limit，从剩余项（含 below-threshold）去重后按分数补充
    const backfillByKey = new Map();
    perQueryResults.forEach((results, queryIndex) => {
        results.forEach((item) => {
            const key = getKey(item);
            if (key && usedKeys.has(key)) return;
            const existing = backfillByKey.get(key);
            if (!existing || scoreOf(item) > scoreOf(existing)) {
                backfillByKey.set(key, { ...item, matched_query_index: queryIndex });
            }
        });
    });
    const backfill = [...backfillByKey.values()].sort(sortByScoreDesc);
    return [...phase1, ...backfill.slice(0, limit - phase1.length)];
};

module.exports = {
    ensureVectorStore,
    seedLawsFromMarkdown,
    seedCasesFromJson,
    searchVectorDocuments,
    searchVectorDocumentsMulti,
    listKnowledgeDocuments,
    importKnowledgeEntries,
    deleteKnowledgeDocuments,
    clearAllVectorDocuments,
    splitTextIntoChunks,
    splitIntoParagraphs,
    splitIntoParagraphGroups,
};
