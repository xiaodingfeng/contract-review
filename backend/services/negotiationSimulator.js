// 谈判博弈模拟服务
// 对每条修改建议,模拟对方立场反向论证,输出反驳理由、折中方案、谈判话术。
// 复用 llmClient.createChatCompletion,JSON 输出。

const { createChatCompletion } = require('./llmClient');

// 去除 LLM 返回中的 markdown / think 标记后解析 JSON
const cleanJsonResponse = (text) => {
    const clean = String(text || '')
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/```json|```/g, '')
        .trim();
    return JSON.parse(clean);
};

// 从合同主体推断对方立场:用户立场为甲方→对方为乙方;反之亦然
const inferCounterpartyPerspective = (userPerspective, contractContext = {}) => {
    const up = String(userPerspective || '').trim();
    if (/甲/.test(up)) return '乙方';
    if (/乙/.test(up)) return '甲方';
    if (/买/.test(up)) return '卖方';
    if (/卖/.test(up)) return '买方';
    if (/出租/.test(up)) return '承租方';
    if (/承租/.test(up)) return '出租方';
    if (/雇主|用人单位/.test(up)) return '劳动者';
    if (/劳动者|员工/.test(up)) return '用人单位';
    // 兜底:从合同主体候选推断
    const parties = contractContext.parties || [];
    if (parties.length >= 2) return parties[1];
    return '对方当事人';
};

// 构造单条修改建议的谈判推演 prompt
const buildSimulationPrompt = (suggestion, contractContext, counterpartyPerspective) => {
    const contractType = contractContext.contract_type || '未指定';
    const contractSummary = contractContext.summary || '未提供';
    const originalText = suggestion.original_text || suggestion.original_clause || '';
    const suggestedText = suggestion.suggested_text || suggestion.modification || '';
    const reason = suggestion.reason || suggestion.rationale || '';

    return `你是一名资深法务谈判专家,正在模拟合同谈判的对方立场反向论证。

合同背景:
- 合同类型:${contractType}
- 合同摘要:${contractSummary}
- 我方立场:${contractContext.user_perspective || '未指定'}
- 对方立场:${counterpartyPerspective}

待推演的修改建议:
- 修改建议标题:${suggestion.title || suggestion.clause || '修改建议'}
- 原文条款:${originalText}
- 我方建议修改为:${suggestedText}
- 修改理由:${reason}

请从「${counterpartyPerspective}」的立场出发,模拟对方对这条修改建议的反向论证,只输出 JSON:

{
  "likely_objections": [
    {
      "reason": "对方可能拒绝的具体理由(1-2 句话)",
      "legal_basis": "对方引用的法律或商业惯例依据,无则填「无明确依据」",
      "business_concern": "对方的商业顾虑(如成本/风险/责任)"
    }
  ],
  "fallback_options": [
    {
      "text": "折中方案条款文本(可直接用于替换)",
      "tradeoff": "我方让步点 vs 对方让步点",
      "risk_change": "采纳折中方案后风险变化说明"
    }
  ],
  "negotiation_talktrack": "200-400 字的谈判话术,融合反驳应对与折中方案推介,可朗读"
}

硬性要求:
- likely_objections 至少 2 条,不超过 4 条
- fallback_options 至少 2 个,不超过 3 个
- negotiation_talktrack 必须是 200-400 字的完整段落,不要分点
- 仅输出 JSON,不输出 markdown 或自然语言解释`;
};

/**
 * 对单条修改建议执行谈判推演。
 * @param {object} suggestion 修改建议对象(含 original_text/suggested_text/reason 等)
 * @param {{contract_type?:string, summary?:string, user_perspective?:string, parties?:string[]}} contractContext 合同上下文
 * @param {string} [counterpartyPerspective] 对方立场,未提供则自动推断
 * @returns {Promise<{suggestion_id:string, counterparty_perspective:string, likely_objections:Array, fallback_options:Array, negotiation_talktrack:string}>}
 */
const simulateNegotiation = async (suggestion, contractContext = {}, counterpartyPerspective) => {
    const counterPerspective = counterpartyPerspective
        || inferCounterpartyPerspective(contractContext.user_perspective, contractContext);

    const prompt = buildSimulationPrompt(suggestion, contractContext, counterPerspective);

    const completion = await createChatCompletion({
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
    });

    const parsed = cleanJsonResponse(completion.choices[0].message.content);

    return {
        suggestion_id: suggestion.id || suggestion.suggestion_id || '',
        suggestion_title: suggestion.title || suggestion.clause || '',
        counterparty_perspective: counterPerspective,
        likely_objections: Array.isArray(parsed.likely_objections) ? parsed.likely_objections : [],
        fallback_options: Array.isArray(parsed.fallback_options) ? parsed.fallback_options : [],
        negotiation_talktrack: parsed.negotiation_talktrack || '',
    };
};

/**
 * 批量并发模拟多条修改建议,并发度 2,单条失败不中断。
 * @param {Array} suggestions 修改建议数组
 * @param {object} contractContext 合同上下文
 * @param {string} [counterpartyPerspective] 对方立场
 * @returns {Promise<Array<{suggestion_id:string, simulation?:object, error?:string}>>}
 */
const simulateNegotiationBatch = async (suggestions, contractContext = {}, counterpartyPerspective) => {
    const list = Array.isArray(suggestions) ? suggestions : [];
    const CONCURRENCY = 2;
    const results = [];

    const simulateOne = async (suggestion) => {
        try {
            const simulation = await simulateNegotiation(suggestion, contractContext, counterpartyPerspective);
            return { suggestion_id: simulation.suggestion_id, simulation };
        } catch (err) {
            console.warn(`[negotiationSimulator] suggestion ${suggestion.id || '?'} 模拟失败:`, err.message);
            return { suggestion_id: suggestion.id || '', error: err.message };
        }
    };

    for (let i = 0; i < list.length; i += CONCURRENCY) {
        const chunk = list.slice(i, i + CONCURRENCY);
        const chunkResults = await Promise.all(chunk.map(simulateOne));
        results.push(...chunkResults);
    }

    return results;
};

module.exports = {
    simulateNegotiation,
    simulateNegotiationBatch,
    inferCounterpartyPerspective,
};
