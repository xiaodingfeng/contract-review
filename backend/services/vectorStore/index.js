/**
 * @file services/vectorStore/index.js
 * @brief 向量库统一入口（Facade），编排各子模块对外暴露一致接口
 *
 * 核心职责：
 * - 整合 relationalStore + milvusStore + seedSources + documentMapping
 * - 提供知识库 seed（法律 Markdown / 案例 JSON）、导入、删除、清空
 * - 提供单/多 query 向量检索，支持 rerank 与阈值过滤
 *
 * 关键实现：
 * - importKnowledgeEntries 双写 PG 与 Milvus 并按 content_hash 去重
 * - seedLawsFromMarkdown/seedCasesFromJson 支持断点续传与进度回调
 * - searchVectorDocumentsMulti 多 query 分通道召回后按 hash 融合去重
 * - 候选集最小 48 条保证 rerank 有效候选
 *
 * 依赖关系：
 * - 上游：../../database、../embeddingClient、../legalMarkdownParser、../caseJsonParser 及本目录各子模块
 * - 下游：被 knowledge、analysisCore 等检索流程及 seed 初始化脚本调用
 */
const path = require('path');
const fs = require('fs');
const db = require('../../database');
const { EMBEDDING_DIM, embedText, ensureEmbeddingReady, rerankDocuments } = require('../embeddingClient');
const { parseLegalMarkdownFile } = require('../legalMarkdownParser');
const { parseCaseJsonDocument } = require('../caseJsonParser');

const { state, KNOWLEDGE_SEED_TYPES, LAW_SEED_FILE_BATCH_SIZE } = require('./config');
const { normalizeText, splitTextIntoChunks, splitIntoParagraphs, splitIntoParagraphGroups } = require('./textChunking');
const { listConfiguredLawDirs, listMarkdownFiles, listCaseJsonFiles, fallbackLawEntryFromFile } = require('./seedSources');
const { ensureRelationalVectorTable, upsertRelationalRow, listKnowledgeDocuments, sqliteVectorSearch, keywordSearch, mergeSearchResults } = require('./relationalStore');
const { ensureMilvusCollection, upsertMilvusRows, deleteMilvusRows, milvusVectorSearch } = require('./milvusStore');
const { toVectorDocumentRows } = require('./documentMapping');

const ensureVectorStore = async () => {
    await ensureRelationalVectorTable();
    await ensureMilvusCollection();
};

// 导入知识条目:双写 PG(vector_documents)与 Milvus。
// skipMilvus=true 时仅写 PG,用于启动阶段先入库 PG、再由后台异步同步到 Milvus。
const importKnowledgeEntries = async (entries, { skipMilvus = false } = {}) => {
    await ensureVectorStore();
    let imported = 0;
    let chunks = 0;
    let deduped = 0;
    let milvusRowsBuffer = [];

    const flushMilvusRows = async () => {
        if (skipMilvus || milvusRowsBuffer.length === 0) return;
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
        if (!skipMilvus) {
            milvusRowsBuffer.push(...uniqueRows);
            if (milvusRowsBuffer.length >= 200) {
                await flushMilvusRows();
            }
        }
        imported += 1;
        chunks += uniqueRows.length;
    }
    await flushMilvusRows();

    return { imported, chunks, deduped, vectorStore: state.milvusReady ? 'milvus' : 'relational-fallback' };
};

const seedLawsFromMarkdown = async (onProgress, { skipMilvus = false } = {}) => {
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
        console.log('[DB Init] Law data already in PostgreSQL. Skipping startup reseed.');
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

    const totals = { imported: 0, chunks: 0, deduped: 0, files: 0, failed: 0, vectorStore: state.milvusReady ? 'milvus' : 'relational-fallback' };
    let fileCounter = 0;
    for (let i = 0; i < files.length; i += LAW_SEED_FILE_BATCH_SIZE) {
        const batch = files.slice(i, i + LAW_SEED_FILE_BATCH_SIZE);
        const entries = [];
        for (const filePath of batch) {
            const sourceFile = path.relative(path.join(__dirname, '..', '..'), filePath);
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
            const result = await importKnowledgeEntries(entries, { skipMilvus });
            totals.imported += result.imported || 0;
            totals.chunks += result.chunks || 0;
            totals.deduped += result.deduped || 0;
            totals.vectorStore = result.vectorStore || totals.vectorStore;
        }
        console.log(`[DB Init] Law seed progress: ${Math.min(i + batch.length, files.length)}/${files.length} files, ${totals.chunks} chunks.`);
    }

    return totals;
};

const seedCasesFromJson = async (onProgress, { skipMilvus = false } = {}) => {
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
        console.log('[DB Init] Case data already in PostgreSQL. Skipping startup reseed.');
        return { skipped: true, existing: Number(existingCaseCount?.count || 0) };
    }

    const files = listCaseJsonFiles();
    if (files.length === 0) {
        console.warn(`[DB Init] No case JSON files found under ${process.env.CASE_SEED_DIR || 'candidate_55192'}.`);
        return { imported: 0, chunks: 0, files: 0 };
    }

    if (forceReseed) {
        await deleteKnowledgeDocuments({ sourceType: 'case' });
    }

    const entries = [];
    const totals = { imported: 0, chunks: 0, deduped: 0, files: 0, failed: 0, vectorStore: state.milvusReady ? 'milvus' : 'relational-fallback' };
    for (let idx = 0; idx < files.length; idx += 1) {
        const filePath = files[idx];
        const sourceFile = path.relative(path.join(__dirname, '..', '..'), filePath);
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
        const result = await importKnowledgeEntries(entries, { skipMilvus });
        totals.imported += result.imported || 0;
        totals.chunks += result.chunks || 0;
        totals.deduped += result.deduped || 0;
        totals.vectorStore = result.vectorStore || totals.vectorStore;
    }
    console.log(`[DB Init] Case seed finished: ${totals.files}/${files.length} files, ${totals.chunks} chunks.`);
    return totals;
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
        return { deleted: 0, vectorStore: state.milvusReady ? 'milvus' : 'relational-fallback' };
    }
    await deleteMilvusRows(rows);
    await db('vector_documents').whereIn('id', rows.map((row) => row.id)).del();
    return { deleted: rows.length, vectorStore: state.milvusReady ? 'milvus' : 'relational-fallback' };
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
    return { deleted, vectorStore: state.milvusReady ? 'milvus' : 'relational-fallback' };
};

// 将 PG(vector_documents)全量同步到 Milvus,用于启动后台同步与"重建向量数据库"。
// 仅 upsert(按 content_hash 去重更新),不删除 PG 已有数据,也不清空 Milvus;
// Milvus 不可用时跳过并返回降级信息。与初始化时的同步操作完全一致,覆盖所有 source_type。
const syncAllVectorDocuments = async (onProgress) => {
    await ensureVectorStore();
    if (!state.milvusReady) {
        return { synced: 0, total: 0, vectorStore: 'relational-fallback', skipped: true, reason: 'Milvus not ready' };
    }
    const totalRow = await db('vector_documents').count({ count: '*' }).first();
    const total = Number(totalRow?.count || 0);
    if (total === 0) {
        return { synced: 0, total: 0, vectorStore: 'milvus' };
    }
    let synced = 0;
    let lastId = 0;
    while (true) {
        const rows = await db('vector_documents')
            .where('id', '>', lastId)
            .orderBy('id', 'asc')
            .limit(200)
            .select('*');
        if (rows.length === 0) break;
        lastId = rows[rows.length - 1].id;
        const batch = rows.map((row) => ({
            ...row,
            embedding: JSON.parse(row.embedding || '[]'),
        }));
        await upsertMilvusRows(batch);
        synced += batch.length;
        if (onProgress) {
            await onProgress({ current: synced, total });
        }
    }
    return { synced, total, vectorStore: state.milvusReady ? 'milvus' : 'relational-fallback' };
};

const searchVectorDocuments = async (query, { limit = 5, sourceTypes = [], rerank = true, includeHistorical = false } = {}) => {
    await ensureVectorStore();
    const cleanQuery = normalizeText(query);
    const queryVector = await embedText(cleanQuery);
    // 候选集最小 48 条:limit 较小时(如通道 B limit=2),limit*8=16 太小,
    // 会把精确匹配的高相关文档挡在候选集外,rerank 无能为力
    const candidateLimit = Math.max(limit * 8, 48);
    let results = await milvusVectorSearch(queryVector, { limit: candidateLimit, sourceTypes, includeHistorical });
    // Milvus 返回空数组时也回退到关系库（避免 Milvus 无数据但 SQLite 有数据时搜不到）
    if (!results || results.length === 0) {
        if (results && results.length === 0 && state.milvusReady) {
            console.log('[Vector Search] Milvus returned 0 results, falling back to relational vectors.');
        }
        results = await sqliteVectorSearch(cleanQuery, queryVector, { limit: candidateLimit, sourceTypes, includeHistorical });
    }
    const keywordResults = await keywordSearch(cleanQuery, { limit: candidateLimit, sourceTypes, includeHistorical });
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
    includeHistorical = false,
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
        const results = await searchVectorDocuments(cleanQueries[0], { limit, sourceTypes, rerank, includeHistorical });
        if (scoreThreshold <= 0) return results.slice(0, limit);
        // 软阈值:优先返回 above-threshold,不足 limit 时从 below-threshold 按分数补充
        // 避免阈值过高导致配额用不满、LLM 缺乏依据(对齐多 query 分支 Phase 2 降级逻辑)
        const above = [];
        const below = [];
        for (const item of results) {
            if (item.rerank_score === undefined || item.rerank_score === null) {
                above.push(item); // rerank 不可用时视作 above,不过滤
            } else if (item.rerank_score >= scoreThreshold) {
                above.push(item);
            } else {
                below.push(item);
            }
        }
        if (above.length >= limit) return above.slice(0, limit);
        below.sort((a, b) => (b.rerank_score ?? 0) - (a.rerank_score ?? 0));
        return [...above, ...below.slice(0, Math.max(0, limit - above.length))];
    }

    // 多 query 时每条少取一些，靠融合补足；perQueryLimit 由调用方按通道配置
    const perQueryResults = await Promise.all(
        cleanQueries.map((q) => searchVectorDocuments(q, {
            limit: perQueryLimit,
            sourceTypes,
            rerank,
            includeHistorical,
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
    syncAllVectorDocuments,
    splitTextIntoChunks,
    splitIntoParagraphs,
    splitIntoParagraphGroups,
};
