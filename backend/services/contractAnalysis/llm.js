/**
 * @file services/contractAnalysis/llm.js
 * @brief 封装大模型调用，提供 JSON 结构化响应能力
 *
 * 核心职责：
 * - 调用底层 LLM 客户端发起对话补全请求
 * - 清理模型返回内容中的思考标签与代码块标记
 * - 将清理后的文本解析为 JSON 对象返回
 *
 * 关键实现：
 * - callJsonLLM 强制 response_format 为 json_object
 * - cleanJsonResponse 去除 think 标签与 json 代码块后解析
 *
 * 依赖关系：
 * - 上游：../llmClient（统一的大模型调用客户端）
 * - 下游：被 analysisCore、knowledge 等需要结构化输出的模块调用
 */
const { createChatCompletion } = require('../llmClient');

const cleanJsonResponse = (text) => {
    const clean = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
};

const callJsonLLM = async (prompt) => {
    const completion = await createChatCompletion({
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
    });
    return cleanJsonResponse(completion.choices[0].message.content);
};

module.exports = {
    cleanJsonResponse,
    callJsonLLM,
};
