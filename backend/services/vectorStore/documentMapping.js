/**
 * @file services/vectorStore/documentMapping.js
 * @brief 将知识库 entry 映射为可写入 PG 与 Milvus 的向量文档行
 *
 * 核心职责：
 * - 把法律/案例/自定义 entry 转换为统一的行结构
 * - 解析 metadata、规范化施行日期、生成 content_hash
 * - 调用 embedding 客户端为各 chunk 生成向量
 *
 * 关键实现：
 * - toVectorDocumentRows 按 chunk 调用 embedTexts 生成向量
 * - normalizeEffectiveDate 将中文日期规范化为 ISO 日期
 * - 多 chunk 时 source_id 与 clause_id 追加序号后缀
 *
 * 依赖关系：
 * - 上游：../embeddingClient、./textChunking
 * - 下游：被 index.js importKnowledgeEntries 调用
 */
const { embedTexts } = require('../embeddingClient');
const { splitTextIntoChunks, sourceHash } = require('./textChunking');

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

// 将中文日期(如 "2021年1月1日")规范化为 ISO 日期(YYYY-MM-DD),供 PG date 列与 Milvus VarChar 存储;无法解析时返回 null
const normalizeEffectiveDate = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const match = raw.match(/(\d{4})年(\d{1,2})月(\d{1,2})/);
    if (match) {
        const [, year, month, day] = match;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    // 已是 ISO 格式(YYYY-MM-DD 或 YYYY-M-D)直接返回;其余无法识别的格式返回 null 以避免 PG date 列报错
    return /^\d{4}-\d{1,2}-\d{1,2}$/.test(raw) ? raw : null;
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
            // 法律时效性监控字段(P0):effective_date 规范化为 ISO 日期;law_status 默认 '现行';superseded_by 默认空
            effective_date: normalizeEffectiveDate(entry.effective_date || (entry.metadata && entry.metadata.effective_date)),
            law_status: entry.law_status || '现行',
            superseded_by: entry.superseded_by || '',
        };
    });
};

module.exports = {
    toMetadataObject,
    normalizeEffectiveDate,
    toVectorDocumentRows,
};
