/**
 * @file services/contractAnalysis/analysisCore.js
 * @brief 条款分析核心：证据链构建、标准对比与结果归一化
 *
 * 核心职责：
 * - 为风险点构建证据链（合同原文锚点 + 关联法条 + 证据完整度）
 * - 对合同核心条款检索行业标准库，输出差异说明
 * - 归一化 LLM 审查结果，补充证据字段
 * - 长合同分层审查时聚合各条款结果并做去重与一致性标注
 *
 * 关键实现：
 * - buildEvidence 用 original_clause 在正文中定位字符偏移
 * - buildStandardComparison 按关键词识别核心类别条款并检索标准库
 * - aggregateClauseResults 跨条款去重并检测违约金/付款金额单位一致性
 *
 * 依赖关系：
 * - 上游：../contractParser、../vectorStore
 * - 下游：被 backgroundAnalysis 调用做结果后处理
 */
const contractParser = require('../contractParser');
const { searchVectorDocumentsMulti } = require('../vectorStore');

// 为风险点构建证据链(合同原文锚点 + 关联法条 + 证据完整度)
const buildEvidence = (dp, plainText, relevantLaws) => {
    // 合同原文锚点:用 original_clause 在 plainText 中查找字符偏移
    const anchorText = dp.original_clause || '';
    let contractAnchor = null;
    if (anchorText && plainText) {
        const offset = plainText.indexOf(anchorText);
        if (offset >= 0) {
            contractAnchor = { text: anchorText, char_offset: offset };
        }
    }

    // 关联法条:按 legal_reference 文本匹配 relevant_laws
    // relevant_laws 字段兼容:law/law_name/title(法律名) + clause/clause_id(条款)
    const legalRef = dp.legal_reference || '';
    const legalRefs = (relevantLaws || []).filter((law) => {
        if (!legalRef) return false;
        const lawName = law.law || law.law_name || law.title || '';
        const clauseId = law.clause || law.clause_id || '';
        // 法律名匹配需 >1 字避免单字误命中;条款编号直接 includes
        const nameMatched = lawName && lawName.length > 1 && legalRef.includes(lawName);
        const clauseMatched = clauseId && legalRef.includes(clauseId);
        return nameMatched || clauseMatched;
    }).map((law) => ({
        law_name: law.law || law.law_name || law.title || '',
        clause_id: law.clause || law.clause_id || '',
        content: law.content || law.text || '',
        source_id: law.source_id || '',
        source_url: law.source_url || '',
        effective_date: law.effective_date || '',
        law_status: law.law_status || '现行',
    }));

    // 证据完整度:full(原文+法条)/ partial(仅一项)/ weak(无)
    let completeness = 'weak';
    if (contractAnchor && legalRefs.length > 0) completeness = 'full';
    else if (contractAnchor || legalRefs.length > 0) completeness = 'partial';

    return {
        contract_anchor: contractAnchor,
        legal_refs: legalRefs,
        evidence_completeness: completeness,
    };
};

// 4.3 行业标准条款对比:对合同核心条款检索标准库,输出差异说明
// 核心类别通过关键词匹配识别,最多输出 5 条对比,失败降级返回空数组
const STANDARD_CATEGORY_KEYWORDS = [
    { category: 'confidentiality', label: '保密义务', keywords: ['保密', '机密', '秘密', '不披露'] },
    { category: 'breach', label: '违约责任', keywords: ['违约', '违约金', '赔偿损失', '承担违约'] },
    { category: 'ip', label: '知识产权', keywords: ['知识产权', '专利', '著作权', '商标', '专有技术'] },
    { category: 'dispute', label: '争议解决', keywords: ['争议', '诉讼', '仲裁', '管辖'] },
    { category: 'force_majeure', label: '不可抗力', keywords: ['不可抗力', '不能预见', '不能避免'] },
];

const classifyClauseCategory = (clauseText) => {
    const text = String(clauseText || '');
    if (!text) return null;
    for (const { category, label, keywords } of STANDARD_CATEGORY_KEYWORDS) {
        if (keywords.some((kw) => text.includes(kw))) return { category, label };
    }
    return null;
};

const buildStandardComparison = async (plainText, contractType) => {
    if (!plainText || plainText.length < 50) return [];
    const clauses = contractParser.parseContractTree(plainText);
    if (!clauses.length) return [];

    // 识别核心类别条款,每个类别最多取 1 条(避免重复)
    const clausesByCategory = new Map();
    for (const clause of clauses) {
        const matched = classifyClauseCategory(clause.text);
        if (matched && !clausesByCategory.has(matched.category)) {
            clausesByCategory.set(matched.category, { ...matched, clause });
        }
        if (clausesByCategory.size >= STANDARD_CATEGORY_KEYWORDS.length) break;
    }
    if (clausesByCategory.size === 0) return [];

    const comparisons = [];
    for (const { category, label, clause } of clausesByCategory.values()) {
        try {
            const results = await searchVectorDocumentsMulti([clause.text], {
                sourceTypes: ['standard_clause'],
                limit: 3,
                rerank: true,
                scoreThreshold: 0.3,
            });
            if (results.length === 0) continue;
            // 取最相似的标准条款
            const top = results[0];
            comparisons.push({
                category,
                category_label: label,
                contract_clause_id: clause.clause_id,
                contract_clause_text: String(clause.text).slice(0, 500),
                matched_standard: {
                    standard_id: top.metadata?.standard_id || null,
                    title: top.title || '',
                    category: top.category || category,
                    clause_text: String(top.content || '').slice(0, 500),
                    industry: top.metadata?.industry || '',
                    score: top.rerank_score ?? top.score ?? 0,
                },
                diff_description: `合同条款与「${top.title || label}」标准条款相似度 ${(top.rerank_score ?? top.score ?? 0).toFixed(2)},建议人工对比差异(如保密期限/违约金比例/管辖法院等关键参数)。`,
            });
            if (comparisons.length >= 5) break;
        } catch (err) {
            console.warn(`[standard_comparison] category ${category} failed:`, err.message);
        }
    }
    return comparisons;
};

const normalizeAnalysisResult = (result, plainText = '') => ({
    dispute_points: Array.isArray(result.dispute_points)
        ? result.dispute_points.map((dp) => ({
            ...dp,
            evidence: buildEvidence(dp, plainText, result.relevant_laws || []),
        }))
        : [],
    missing_clauses: Array.isArray(result.missing_clauses) ? result.missing_clauses : [],
    party_review: Array.isArray(result.party_review) ? result.party_review : [],
    modification_suggestions: Array.isArray(result.modification_suggestions) ? result.modification_suggestions : [],
    breach_cost_analysis: Array.isArray(result.breach_cost_analysis) ? result.breach_cost_analysis : [],
    seal_analysis: Array.isArray(result.seal_analysis) ? result.seal_analysis : [],
    relevant_laws: Array.isArray(result.relevant_laws) ? result.relevant_laws : [],
    company_review: Array.isArray(result.company_review) ? result.company_review : [],
});

// 长合同分层审查：聚合各条款的 LLM 结果，做去重与跨条款一致性标注
const aggregateClauseResults = (clauseResults) => {
    const aggregate = {
        dispute_points: [],
        missing_clauses: [],
        party_review: [],
        modification_suggestions: [],
        breach_cost_analysis: [],
        seal_analysis: [],
        relevant_laws: [],
        company_review: [],
    };
    const dpSeen = new Set();        // dispute_points 去重：title+original_clause
    const mcSeen = new Set();        // missing_clauses 去重：title
    const msOriginalSeen = new Map(); // modification_suggestions original_text → clause_id（跨条款重复标注）
    for (const res of clauseResults) {
        const clauseId = res.clause_id || '';
        for (const dp of (res.dispute_points || [])) {
            const key = `${dp.title || ''}|${dp.original_clause || ''}`;
            if (dpSeen.has(key)) continue;
            dpSeen.add(key);
            aggregate.dispute_points.push({ ...dp, clause_id: clauseId });
        }
        for (const mc of (res.missing_clauses || [])) {
            const key = mc.title || '';
            if (mcSeen.has(key)) continue;
            mcSeen.add(key);
            aggregate.missing_clauses.push(mc);
        }
        for (const pr of (res.party_review || [])) aggregate.party_review.push(pr);
        for (const ms of (res.modification_suggestions || [])) {
            const key = String(ms.original_text || '').trim();
            const item = { ...ms, clause_id: clauseId };
            if (key) {
                if (msOriginalSeen.has(key)) {
                    // 跨条款重复：标注，不删除（供前端提示人工复核一致性）
                    item.cross_clause_duplicate = true;
                    item.cross_clause_with = msOriginalSeen.get(key);
                } else {
                    msOriginalSeen.set(key, clauseId);
                }
            }
            aggregate.modification_suggestions.push(item);
        }
        for (const bc of (res.breach_cost_analysis || [])) aggregate.breach_cost_analysis.push(bc);
    }
    // 跨条款一致性检查:违约金 vs 付款金额口径
    const extractAmount = (text) => {
        if (!text) return null;
        const m = String(text).match(/(\d+(?:\.\d+)?)\s*(元|万元|%|‰|百分之)/);
        return m ? { value: parseFloat(m[1]), unit: m[2], raw: m[0] } : null;
    };
    const breachAmounts = [];
    const paymentAmounts = [];
    for (const r of clauseResults) {
        for (const dp of (r.dispute_points || [])) {
            if (String(dp.title || '').includes('违约金') || String(dp.original_clause || '').includes('违约金')) {
                const amt = extractAmount(dp.original_clause) || extractAmount(dp.dispute_rationale);
                if (amt) breachAmounts.push({ clause_id: r.clause_id, ...amt });
            }
        }
        for (const ms of (r.modification_suggestions || [])) {
            if (String(ms.title || '').includes('付款') || String(ms.original_text || '').includes('付款')) {
                const amt = extractAmount(ms.original_text);
                if (amt) paymentAmounts.push({ clause_id: r.clause_id, ...amt });
            }
        }
    }
    // 标注:若违约金与付款金额口径不一致(单位不同或各自内部单位不统一),添加一致性提示
    if (breachAmounts.length && paymentAmounts.length) {
        const breachUnits = new Set(breachAmounts.map(a => a.unit));
        const paymentUnits = new Set(paymentAmounts.map(a => a.unit));
        if (breachUnits.size > 1 || paymentUnits.size > 1 || (breachUnits.size === 1 && paymentUnits.size === 1 && [...breachUnits][0] !== [...paymentUnits][0])) {
            aggregate.consistency_warnings = [{
                type: 'amount_unit_mismatch',
                description: '违约金与付款条款金额单位不一致,建议人工复核口径',
                breach_amounts: breachAmounts,
                payment_amounts: paymentAmounts,
            }];
        }
    }
    return aggregate;
};

module.exports = {
    buildEvidence,
    STANDARD_CATEGORY_KEYWORDS,
    classifyClauseCategory,
    buildStandardComparison,
    normalizeAnalysisResult,
    aggregateClauseResults,
};
