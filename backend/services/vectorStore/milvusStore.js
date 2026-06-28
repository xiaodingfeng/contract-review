/**
 * @file services/vectorStore/milvusStore.js
 * @brief Milvus 向量存储层，封装 SDK 调用并支持降级回退
 *
 * 核心职责：
 * - 管理 Milvus 连接单例与 collection 初始化
 * - 行 upsert/delete，关系库→Milvus 同步
 * - 向量搜索，失败时降级到关系库路径
 *
 * 关键实现：
 * - SDK 延迟加载，未安装时自动降级
 * - getMilvusClient 带连接超时与单例缓存
 * - ensureMilvusCollection 创建含时效性字段的 HNSW 索引
 * - 所有调用 try/catch，保证关系库元数据始终可用
 *
 * 依赖关系：
 * - 上游：../../database、../embeddingClient、./config、./textChunking、@zilliz/milvus2-sdk-node（可选）
 * - 下游：被 index.js 作为 Milvus 路径调用
 */
const db = require('../../database');
const { EMBEDDING_DIM } = require('../embeddingClient');
const { COLLECTION_NAME, VECTOR_FIELD, MILVUS_CONNECT_TIMEOUT_MS, state } = require('./config');
const { escapeExpr } = require('./textChunking');

// SDK 延迟加载：未安装时降级到关系库路径
let MilvusClient;
let DataType;
let MetricType;
try {
    ({ MilvusClient, DataType, MetricType } = require('@zilliz/milvus2-sdk-node'));
} catch (error) {
    console.warn('[Milvus] SDK not installed. Relational vector fallback will be used.');
}

const getMilvusClient = async () => {
    const vectorStore = String(process.env.VECTOR_STORE || '').toLowerCase();
    if (!MilvusClient || ['sqlite', 'postgres', 'relational'].includes(vectorStore)) return null;
    if (!process.env.MILVUS_ADDRESS) return null;
    if (!state.milvusClientPromise) {
        state.milvusClientPromise = (async () => {
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
    return state.milvusClientPromise;
};

const ensureMilvusCollection = async () => {
    try {
        const client = await getMilvusClient();
        if (!client) return false;
        const exists = await client.hasCollection({ collection_name: COLLECTION_NAME });
        const hasCollection = exists?.value === true;
        // 注意:Milvus collection 一旦创建,schema 不可变。若 collection 已存在则跳过创建,
        // 新增字段(law_status/superseded_by/effective_date)需要手动重建 collection
        // (drop + create + 重新 seed)或通过 MILVUS_COLLECTION 环境变量切换到新 collection 名。
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
                    // 法律时效性监控字段(P0):Milvus 无 DATE 类型,effective_date 用 VarChar 存 ISO 日期字符串
                    { name: 'law_status', data_type: DataType.VarChar, max_length: 16 },
                    { name: 'superseded_by', data_type: DataType.VarChar, max_length: 64 },
                    { name: 'effective_date', data_type: DataType.VarChar, max_length: 32 },
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
        state.milvusReady = true;
        return true;
    } catch (error) {
        state.milvusClientPromise = null;
        state.milvusReady = false;
        console.warn(`[Milvus] Collection init failed: ${error.message}. Relational vector fallback will be used.`);
        return false;
    }
};

const deleteMilvusRows = async (rows) => {
    if (!state.milvusReady || rows.length === 0) return false;
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

const upsertMilvusRows = async (rows) => {
    if (rows.length === 0) return false;
    if (!state.milvusReady) return false;
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
                // 法律时效性监控字段(P0):与 PG 双写保持一致(VarChar 长度与 collection schema 对齐)
                law_status: String(row.law_status || '现行').slice(0, 16),
                superseded_by: String(row.superseded_by || '').slice(0, 64),
                effective_date: String(row.effective_date || '').slice(0, 32),
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
    if (!state.milvusReady) return false;
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
    if (!state.milvusReady) return { synced: 0, vectorStore: 'relational-fallback' };
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
    return { synced, vectorStore: state.milvusReady ? 'milvus' : 'relational-fallback' };
};

const milvusVectorSearch = async (queryVector, { limit, sourceTypes, includeHistorical }) => {
    if (!state.milvusReady) return null;
    const client = await getMilvusClient();
    if (!client) return null;
    try {
        // 默认仅召回现行法律;law_status 为空字符串的旧数据视作现行,确保向后兼容
        // (若 collection 未含 law_status 字段,Milvus 会抛错并被下方 catch 捕获,回退到 PG 路径同样过滤)
        const filterParts = [];
        if (sourceTypes.length) {
            filterParts.push(`source_type in [${sourceTypes.map((item) => `"${escapeExpr(item)}"`).join(',')}]`);
        }
        if (!includeHistorical) {
            filterParts.push(`(law_status == "现行" || law_status == "")`);
        }
        const filter = filterParts.length ? filterParts.join(' && ') : undefined;
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

module.exports = {
    getMilvusClient,
    ensureMilvusCollection,
    upsertMilvusRows,
    hasMilvusRows,
    syncRelationalRowsToMilvus,
    deleteMilvusRows,
    milvusVectorSearch,
};
