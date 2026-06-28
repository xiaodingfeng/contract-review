/**
 * @file services/vectorStore/relationalStore.js
 * @brief 关系型向量存储层（PostgreSQL / SQLite）及 Milvus 不可用时的回退搜索
 *
 * 核心职责：
 * - 初始化 vector_documents 表 schema 并向后兼容补加新字段
 * - 行 upsert（按 content_hash/source_id 去重）与分页列表查询
 * - 提供 PG 向量余弦相似度搜索与关键词搜索，作为 Milvus 回退路径
 *
 * 关键实现：
 * - ensureRelationalVectorTable 检测并补加 law_status 等时效性字段
 * - sqliteVectorSearch 在应用层计算点积近似余弦相似度
 * - tokenizeQuery 对长中文 token 做 2-3 字 ngram 二次切分提升召回
 * - mergeSearchResults 融合向量与关键词结果按综合分排序
 *
 * 依赖关系：
 * - 上游：../../database、./textChunking、./documentMapping
 * - 下游：被 index.js 作为关系库路径调用
 */
const db = require('../../database');
const { normalizeText } = require('./textChunking');
const { toMetadataObject } = require('./documentMapping');

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
            // 法律时效性监控字段(P0):law_status=现行/已修订/已废止,superseded_by 指向新版本,effective_date 为施行日期
            table.string('law_status').defaultTo('现行');
            table.string('superseded_by');
            table.date('effective_date');
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
    // 法律时效性监控字段(P0):向后兼容旧库,缺失时补加;law_status 默认 '现行' 保证旧数据可被检索
    await addColumn('law_status', (table) => table.string('law_status').defaultTo('现行'));
    await addColumn('superseded_by', (table) => table.string('superseded_by'));
    await addColumn('effective_date', (table) => table.date('effective_date'));
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

const listKnowledgeDocuments = async ({
    page = 1,
    pageSize = 10,
    query = '',
    sourceType = '',
    lawStatus = '',
} = {}) => {
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 10));
    const offset = (safePage - 1) * safePageSize;
    const keyword = normalizeText(query);

    const applyFilters = (builder) => {
        if (sourceType) builder.where('source_type', sourceType);
        // 法律时效性过滤:现行 视作包含 NULL 旧数据(向后兼容);已修订/已废止 精确匹配
        if (lawStatus === '现行') {
            builder.andWhere(function () {
                this.where('law_status', '现行').orWhereNull('law_status');
            });
        } else if (lawStatus === '已修订' || lawStatus === '已废止') {
            builder.where('law_status', lawStatus);
        }
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
            'law_status',
            'updated_at',
        )
        .orderBy('updated_at', 'desc')
        .limit(safePageSize)
        .offset(offset);

    return {
        page: safePage,
        pageSize: safePageSize,
        total: Number(totalRow?.total || 0),
        items: rows.map((row) => ({
            ...row,
            // law_status 为 NULL 的旧数据视作现行(向后兼容)
            law_status: row.law_status || '现行',
            metadata: toMetadataObject(row.metadata),
        })),
    };
};

const sqliteVectorSearch = async (query, queryVector, { limit, sourceTypes, includeHistorical }) => {
    let rowsQuery = db('vector_documents');
    if (sourceTypes.length > 0) rowsQuery = rowsQuery.whereIn('source_type', sourceTypes);
    // 默认仅召回现行法律;law_status 为 NULL 的旧数据视作现行,确保向后兼容
    if (!includeHistorical) {
        rowsQuery = rowsQuery.andWhere(function () {
            this.where('law_status', '现行').orWhereNull('law_status');
        });
    }
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
    const rawTerms = text.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{2,}/g) || [];
    const stopwords = new Set(['合同', '条款', '风险', '审查', '问题', '建议', '相关', '依据', '法律', '法规', '甲方', '乙方', '应当', '可以', '不得', '本合同', '进行', '以及', '或者']);

    // 对长中文 token 做 2-3 字 ngram 二次切分,提升短关键词召回
    // 否则"甲方应当在解除或终止本合同时"会被当成 14 字整体,LIKE 匹配不到任何 content
    const expandedTerms = new Set();
    for (const term of rawTerms) {
        if (/[\u4e00-\u9fa5]/.test(term) && term.length > 4) {
            // 长中文 token:提取 2 字 bigram 和 3 字 trigram
            for (let i = 0; i < term.length - 1; i += 1) {
                const bigram = term.slice(i, i + 2);
                if (bigram.length === 2) expandedTerms.add(bigram);
            }
            for (let i = 0; i < term.length - 2; i += 1) {
                const trigram = term.slice(i, i + 3);
                if (trigram.length === 3) expandedTerms.add(trigram);
            }
            // 同时保留原长 token(用于精确长 content 匹配,如法律名称)
            expandedTerms.add(term);
        } else {
            expandedTerms.add(term);
        }
    }

    return [...expandedTerms]
        .filter((term) => !stopwords.has(term) && term.length <= 24 && term.length >= 2)
        .slice(0, 40);
};

const keywordSearch = async (query, { limit, sourceTypes, includeHistorical }) => {
    const terms = tokenizeQuery(query);
    if (terms.length === 0) return [];

    let rowsQuery = db('vector_documents');
    if (sourceTypes.length > 0) rowsQuery = rowsQuery.whereIn('source_type', sourceTypes);
    // 默认仅召回现行法律;law_status 为 NULL 的旧数据视作现行,确保向后兼容
    if (!includeHistorical) {
        rowsQuery = rowsQuery.andWhere(function () {
            this.where('law_status', '现行').orWhereNull('law_status');
        });
    }
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

module.exports = {
    ensureRelationalVectorTable,
    upsertRelationalRow,
    listKnowledgeDocuments,
    sqliteVectorSearch,
    keywordSearch,
    mergeSearchResults,
};
