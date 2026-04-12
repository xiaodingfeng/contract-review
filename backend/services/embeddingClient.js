const axios = require('axios');
const crypto = require('crypto');

const EMBEDDING_BASE_URL = process.env.EMBEDDING_BASE_URL || process.env.LLM_BASE_URL;
const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || process.env.LLM_API_KEY;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'BAAI/bge-m3';
const RERANK_BASE_URL = process.env.RERANK_BASE_URL || EMBEDDING_BASE_URL;
const RERANK_API_KEY = process.env.RERANK_API_KEY || EMBEDDING_API_KEY;
const RERANK_MODEL = process.env.RERANK_MODEL || 'BAAI/bge-reranker-v2-m3';
const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIM || 1024);
const EMBEDDING_BATCH_SIZE = Math.max(1, Number(process.env.EMBEDDING_BATCH_SIZE || 32));

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
        console.warn('[Embedding] EMBEDDING_BASE_URL/API_KEY missing. Falling back to local hash vectors.');
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
        console.warn(`[Embedding] Online embedding failed: ${error.message}. Falling back to local hash vectors.`);
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
        console.warn(`[Rerank] Online rerank failed: ${error.message}. Using vector scores only.`);
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
