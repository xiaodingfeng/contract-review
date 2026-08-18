/**
 * @file services/embeddingClient.js
 * @brief 文本嵌入与重排序客户端，支持在线 API 调用与本地哈希回退
 *
 * 核心职责：
 * - 批量文本嵌入（embedTexts）与单文本嵌入（embedText）
 * - 文档重排序（rerankDocuments）
 * - 嵌入服务就绪检查（ensureEmbeddingReady）
 *
 * 关键实现：
 * - 默认模型 BAAI/bge-m3，重排序 BAAI/bge-reranker-v2-m3
 * - 批量分块调用（默认每批 32 条），超批自动拆分
 * - 配置缺失或在线失败时回退到本地 sha256 哈希向量（token + bigram）
 * - rerank 失败时回退到原序截断
 *
 * 依赖关系：
 * - 上游：axios、crypto
 * - 下游：reviewTemplates（模板匹配）、vectorStore（向量入库）
 */

const axios = require('axios');
const crypto = require('crypto');

// 向量/重排服务必须显式配置。聊天模型地址并不必然提供 /embeddings 或 /rerank，
// 直接继承 LLM_BASE_URL 会在 DeepSeek 等聊天服务上制造大量 404 请求。
const EMBEDDING_BASE_URL = process.env.EMBEDDING_BASE_URL || '';
const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || (EMBEDDING_BASE_URL ? process.env.LLM_API_KEY : '');
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'BAAI/bge-m3';
const RERANK_BASE_URL = process.env.RERANK_BASE_URL || EMBEDDING_BASE_URL;
const RERANK_API_KEY = process.env.RERANK_API_KEY || EMBEDDING_API_KEY;
const RERANK_MODEL = process.env.RERANK_MODEL || 'BAAI/bge-reranker-v2-m3';
const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIM || 1024);
const EMBEDDING_BATCH_SIZE = Math.max(1, Number(process.env.EMBEDDING_BATCH_SIZE || 32));
const PROVIDER_BACKOFF_MS = Math.max(1000, Number(process.env.EMBEDDING_PROVIDER_BACKOFF_MS || 300000));
let embeddingUnavailableUntil = 0;
let rerankUnavailableUntil = 0;
let embeddingFallbackLogged = false;
let rerankFallbackLogged = false;

const hashFallbackEmbedding = (text) => {
    const vector = new Array(EMBEDDING_DIM).fill(0);
    const normalized = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const tokens = normalized.match(/[\u4e00-\u9fa5]|[a-z0-9]+/g) || [];
    const grams = [...tokens];
    for (let i = 0; i < tokens.length - 1; i += 1) grams.push(`${tokens[i]}${tokens[i + 1]}`);
    for (const token of grams) {
        const digest = crypto.createHash('sha256').update(token).digest();
        const index = digest.readUInt32BE(0) % EMBEDDING_DIM;
        vector[index] += digest[4] % 2 === 0 ? 1 : -1;
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return norm ? vector.map((value) => Number((value / norm).toFixed(6))) : vector;
};

const embeddingUrl = () => `${String(EMBEDDING_BASE_URL || '').replace(/\/$/, '')}/embeddings`;

const rerankUrl = () => `${String(RERANK_BASE_URL || '').replace(/\/$/, '')}/rerank`;

const embedTexts = async (texts) => {
    const input = Array.isArray(texts) ? texts : [texts];
    if (input.length > EMBEDDING_BATCH_SIZE) {
        const batches = [];
        for (let i = 0; i < input.length; i += EMBEDDING_BATCH_SIZE) {
            batches.push(...await embedTexts(input.slice(i, i + EMBEDDING_BATCH_SIZE)));
        }
        return batches;
    }

    if (!EMBEDDING_BASE_URL || !EMBEDDING_API_KEY) {
        if (!embeddingFallbackLogged) {
            console.warn('[Embedding] EMBEDDING_BASE_URL/API_KEY missing. Falling back to local hash vectors.');
            embeddingFallbackLogged = true;
        }
        return input.map(hashFallbackEmbedding);
    }

    if (Date.now() < embeddingUnavailableUntil) {
        return input.map(hashFallbackEmbedding);
    }

    try {
        const response = await axios.post(
            embeddingUrl(),
            { model: EMBEDDING_MODEL, input },
            { headers: { Authorization: `Bearer ${EMBEDDING_API_KEY}` }, timeout: 60000 },
        );
        const data = response.data?.data || [];
        return data.map((item) => item.embedding);
    } catch (error) {
        const status = error.response?.status;
        const respData = error.response?.data;
        const detail = respData
            ? (typeof respData === 'string' ? respData.substring(0, 200) : JSON.stringify(respData).substring(0, 200))
            : '';
        embeddingUnavailableUntil = Date.now() + PROVIDER_BACKOFF_MS;
        console.warn(`[Embedding] Online embedding failed: ${error.message}${status ? ` (HTTP ${status})` : ''}${detail ? ` Response: ${detail}` : ''}. Falling back to local hash vectors for ${Math.round(PROVIDER_BACKOFF_MS / 1000)}s.`);
        return input.map(hashFallbackEmbedding);
    }
};

const embedText = async (text) => {
    const [embedding] = await embedTexts([text]);
    return embedding;
};

const ensureEmbeddingReady = async () => {
    const [embedding] = await embedTexts(['合同审查知识库初始化']);
    return Array.isArray(embedding) && embedding.length === EMBEDDING_DIM;
};

const rerankDocuments = async (query, documents, topN) => {
    if (!documents.length || !RERANK_BASE_URL || !RERANK_API_KEY) return documents.slice(0, topN || documents.length);
    if (Date.now() < rerankUnavailableUntil) return documents.slice(0, topN || documents.length);

    try {
        const response = await axios.post(
            rerankUrl(),
            {
                model: RERANK_MODEL,
                query,
                documents: documents.map((item) => `${item.title}\n${item.content}`),
                top_n: topN || documents.length,
            },
            { headers: { Authorization: `Bearer ${RERANK_API_KEY}` }, timeout: 60000 },
        );
        const results = response.data?.results || [];
        if (!Array.isArray(results) || results.length === 0) return documents.slice(0, topN || documents.length);

        return results
            .map((result) => {
                const source = documents[result.index];
                if (!source) return null;
                return { ...source, rerank_score: result.relevance_score ?? result.score };
            })
            .filter(Boolean);
    } catch (error) {
        rerankUnavailableUntil = Date.now() + PROVIDER_BACKOFF_MS;
        if (!rerankFallbackLogged || error.response?.status !== 404) {
            console.warn(`[Rerank] Online rerank failed: ${error.message}. Using vector scores only for ${Math.round(PROVIDER_BACKOFF_MS / 1000)}s.`);
            rerankFallbackLogged = true;
        }
        return documents.slice(0, topN || documents.length);
    }
};

module.exports = {
    EMBEDDING_DIM,
    EMBEDDING_MODEL,
    RERANK_MODEL,
    embedText,
    embedTexts,
    ensureEmbeddingReady,
    rerankDocuments,
};
