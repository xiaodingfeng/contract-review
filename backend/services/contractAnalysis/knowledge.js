/**
 * @file services/contractAnalysis/knowledge.js
 * @brief 向量知识库检索与法条状态更新标注
 *
 * 核心职责：
 * - 双通道召回法律依据：通道 A（审查维度法律语言）+ 通道 B（合同内容）
 * - 置信加权融合两通道结果，双通道命中项加分优先保留
 * - 标注法条修订/废止状态及替代条文，提示引用风险
 *
 * 关键实现：
 * - getRelevantKnowledge 支持 字符串/byClause/对象 三种入口
 * - mergeChannelsWithConfidence 按 confidence_boost 与 rerank_score 排序
 * - annotateKnowledgeUpdates 批量查询 law_versions 构建更新提示
 *
 * 依赖关系：
 * - 上游：../../database、../vectorStore
 * - 下游：被 backgroundAnalysis、analysisCore 等检索流程调用
 */
const db = require('../../database');
const { searchVectorDocumentsMulti, splitIntoParagraphGroups } = require('../vectorStore');

// 合同正文段落 chunk 检索上限：0 = 不限；超过部分不再生成子 query，控制长合同的检索成本
const CONTRACT_CHUNK_MAX = Math.max(0, Number(process.env.CONTRACT_CHUNK_MAX || 0));

const ensureUploadUser = async (trx, userId) => {
    const numericUserId = Number(userId);
    if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
        throw new Error('INVALID_USER_ID');
    }

    const existing = await trx('users').where({ id: numericUserId }).first();
    if (existing) return numericUserId;

    await trx('users')
        .insert({
            id: numericUserId,
            fingerprint_id: `legacy-upload-user-${numericUserId}`,
        })
        .onConflict('id')
        .ignore();

    await trx.raw("select setval(pg_get_serial_sequence('users', 'id'), greatest((select coalesce(max(id), 0) from users), 1), true)");
    return numericUserId;
};

const compactText = (value, maxLength = 4000) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

// 通道 A「审查维度」query 构建：合同类型+立场、每个审查点、每个核心目的、用户问题
// 这些是法律语言，与法条同语言空间，embedding 匹配精度高，是召回主力
// 合同正文不进通道 A（合同语言会稀释法律意图），改由通道 B 独立召回
const buildChannelAQueries = ({
    contractType = '',
    reviewPoints = [],
    corePurposes = [],
    question = '',
    perspective = '',
} = {}) => {
    const queries = [];
    const perspectiveSuffix = perspective ? `${perspective} 立场` : '';

    if (contractType || perspectiveSuffix) {
        queries.push([
            contractType,
            perspectiveSuffix || '法律 风险 责任 权利义务',
        ].filter(Boolean).join(' '));
    }

    (reviewPoints || []).forEach((point) => {
        queries.push([
            contractType,
            point,
            perspectiveSuffix,
        ].filter(Boolean).join(' '));
    });

    (corePurposes || []).forEach((purpose) => {
        queries.push([
            contractType,
            purpose,
        ].filter(Boolean).join(' '));
    });

    if (question) queries.push(String(question).trim());

    return queries.filter(Boolean);
};

// 通道 B（合同内容）阈值：0.5 为 rerank "可能相关" 下限,配合单 query 降级补充
// 设 0.7 会把"合同条款 vs 法律条文"这类语义相似但表述不同的命中全过滤掉,导致专项审查无依据
const CHANNEL_B_SCORE_THRESHOLD = 0.5;

// 把向量检索结果映射为对外披露的 relevantKnowledge 项
const toRelevantKnowledgeItem = (item) => ({
    source_type: item.source_type,
    law: item.title,
    clause: item.clause_id || item.source_id,
    content: item.content,
    score: item.rerank_score ?? item.score,
    source_name: item.source_name,
    source_url: item.source_url,
    metadata: item.metadata || {},
});

// 置信加权融合：通道 A（审查维度）与通道 B（合同内容）同时命中的法条置信最高，优先保留并加分
// 仅 A 或仅 B 命中的项按分数排序在后；去重按 content_hash/source_id
const mergeChannelsWithConfidence = (channelA, channelB, limit) => {
    const getKey = (item) => item.content_hash || item.source_id || item.id;
    const scoreOf = (item) => item.rerank_score ?? item.score ?? 0;
    const merged = new Map();

    for (const item of channelA) {
        merged.set(getKey(item), { ...item, channel: 'A', confidence_boost: false });
    }
    for (const item of channelB) {
        const key = getKey(item);
        const existing = merged.get(key);
        if (existing) {
            // 两通道同时命中：置信最高，加分并标记
            existing.confidence_boost = true;
            const maxScore = Math.max(scoreOf(existing), scoreOf(item));
            existing.rerank_score = maxScore + 0.05;
            existing.score = maxScore;
        } else {
            merged.set(key, { ...item, channel: 'B', confidence_boost: false });
        }
    }

    return [...merged.values()]
        .sort((a, b) => {
            if (a.confidence_boost !== b.confidence_boost) return a.confidence_boost ? -1 : 1;
            return scoreOf(b) - scoreOf(a);
        })
        .slice(0, limit);
};

// 知识库检索：分通道召回 + 配额融合
//   通道 A「审查维度」法律语言，主力，占 2/3 配额，每条 query 召回 3 条
//   通道 B「合同内容」捞审查点未覆盖的非常规条款，补充，占 1/3 配额，每条 query 仅 top-1 且强阈值
// CONTRACT_CHUNK_MAX > 0 时限制通道 B 的 chunk 数，控制长合同检索成本
const getRelevantKnowledge = async (options, limit = 8) => {
    const sourceTypes = ['law', 'case', 'rule', 'guide'];

    // 字符串入口（纯文本）：单通道，按段落归并检索
    if (typeof options === 'string') {
        const queries = splitIntoParagraphGroups(options, { groupSize: 2, maxChars: 500, minChars: 5 });
        const matches = await searchVectorDocumentsMulti(queries, {
            limit,
            sourceTypes,
            rerank: true,
        });
        return matches.map(toRelevantKnowledgeItem);
    }

    // byClause 分支：长合同分层审查时，按条款独立检索，结果附加 clause_id
    if (options && options.byClause && Array.isArray(options.clauses) && options.clauses.length) {
        const perClauseLimit = Math.max(2, Math.floor(limit / options.clauses.length)) || limit;
        const merged = [];
        const seenKeys = new Set();
        for (const clause of options.clauses) {
            const queries = [clause.title, clause.text]
                .filter(Boolean)
                .filter((q) => String(q).length >= 5);
            if (!queries.length) continue;
            const matches = await searchVectorDocumentsMulti(queries, {
                limit: perClauseLimit,
                sourceTypes,
                rerank: true,
            });
            for (const m of matches) {
                const key = m.content_hash || m.source_id || m.id;
                if (key && seenKeys.has(key)) continue;
                if (key) seenKeys.add(key);
                merged.push({ ...toRelevantKnowledgeItem(m), clause_id: clause.clause_id });
            }
        }
        return merged;
    }

    const channelAQueries = buildChannelAQueries(options);
    // 专项审查:text 是用户选中的核心条款,作为通道 A 高优先级 query,提升精准命中
    // 全文审查时 text 过长(>500 字),不作为 query,避免通道 A 被合同原文稀释
    const rawText = String(options.text || '').trim();
    if (rawText.length >= 5 && rawText.length <= 500) {
        channelAQueries.unshift(rawText);
    }
    let channelBQueries = splitIntoParagraphGroups(options.text || '', { groupSize: 2, maxChars: 500, minChars: 5 });
    if (CONTRACT_CHUNK_MAX > 0) channelBQueries = channelBQueries.slice(0, CONTRACT_CHUNK_MAX);

    const quotaA = Math.max(1, Math.round((limit * 2) / 3));
    const quotaB = Math.max(0, limit - quotaA);

    const [channelA, channelB] = await Promise.all([
        channelAQueries.length
            ? searchVectorDocumentsMulti(channelAQueries, {
                limit: quotaA,
                sourceTypes,
                rerank: true,
                perQueryLimit: 3,
            })
            : Promise.resolve([]),
        (channelBQueries.length && quotaB > 0)
            ? searchVectorDocumentsMulti(channelBQueries, {
                limit: quotaB,
                sourceTypes,
                rerank: true,
                perQueryLimit: 1,
                scoreThreshold: CHANNEL_B_SCORE_THRESHOLD,
            })
            : Promise.resolve([]),
    ]);

    return mergeChannelsWithConfidence(channelA, channelB, limit).map(toRelevantKnowledgeItem);
};

const annotateKnowledgeUpdates = async (items) => {
    // 批量收集 superseded_by 中的数字 id，一次性查询 law_versions 表构建 id→title 映射，避免逐条查库
    const supersededIds = items
        .map((item) => item.superseded_by)
        .filter(Boolean)
        .filter((v) => /^\d+$/.test(String(v)))
        .map((v) => Number(v));

    let supersededTitleMap = {};
    if (supersededIds.length) {
        const versions = await db('law_versions')
            .whereIn('id', [...new Set(supersededIds)])
            .select('id', 'title');
        supersededTitleMap = Object.fromEntries(versions.map((v) => [v.id, v.title]));
    }

    return items.map((item) => {
        // law_status 优先取直接字段，其次 metadata，缺失则默认"现行"（向后兼容旧数据）
        const lawStatus = item.law_status || item.metadata?.law_status || '现行';
        const hasUpdate = lawStatus === '已修订' || lawStatus === '已废止';

        let updateNotice = '当前知识库未标记该依据存在更新；正式出具意见前仍应核对最新法律、司法解释和裁判文书。';
        if (hasUpdate) {
            // superseded_by 为数字 id 时查映射表；为字符串时直接用作标题
            const supersededById = item.superseded_by;
            let supersededTitle = '';
            if (supersededById && /^\d+$/.test(String(supersededById))) {
                supersededTitle = supersededTitleMap[Number(supersededById)] || '';
            } else if (typeof supersededById === 'string' && supersededById.trim()) {
                supersededTitle = supersededById;
            }
            updateNotice = supersededTitle
                ? `该条文已被《${supersededTitle}》修订，仅作历史参考。`
                : '该条文已被修订，仅作历史参考。';
        }

        return {
            ...item,
            law_status: lawStatus,
            hasUpdate,
            updateNotice,
        };
    });
};

module.exports = {
    ensureUploadUser,
    compactText,
    buildChannelAQueries,
    toRelevantKnowledgeItem,
    mergeChannelsWithConfidence,
    getRelevantKnowledge,
    annotateKnowledgeUpdates,
};
