/**
 * @file services/llmClient.js
 * @brief OpenAI 兼容大模型客户端封装，提供聊天与视觉补全调用及重试机制
 *
 * 核心职责：
 * - 懒加载并复用 OpenAI 客户端实例（基于环境变量配置）
 * - 提供聊天补全（createChatCompletion）与视觉补全（createVisionCompletion）接口
 * - 对可重试错误（408/409/429/5xx）执行指数退避重试
 *
 * 关键实现：
 * - 通过环境变量 LLM_API_KEY/LLM_BASE_URL/LLM_MODEL 配置客户端
 * - 视觉模型可通过 VISION_MODEL_NAME 指定，默认 Qwen2.5-VL
 * - 重试次数、退避基数、超时均可通过环境变量调节
 *
 * 依赖关系：
 * - 上游：openai 官方 SDK
 * - 下游：incrementalReview、negotiationSimulator、reviewTemplates 等需要 LLM 的服务
 */

const { OpenAI } = require('openai');

let llmClient;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getRequiredEnv = (name) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required for OpenAI-compatible LLM calls.`);
    return value;
};

const getLlmClient = () => {
    if (!llmClient) {
        llmClient = new OpenAI({
            apiKey: getRequiredEnv('LLM_API_KEY'),
            baseURL: getRequiredEnv('LLM_BASE_URL'),
        });
    }
    return llmClient;
};

const isRetryableError = (error) => {
    const status = error?.status || error?.response?.status;
    if (!status) return true;
    return status === 408 || status === 409 || status === 429 || status >= 500;
};

const createChatCompletion = async (options, requestOptions = {}) => {
    const { maxRetries: requestMaxRetries, ...sdkRequestOptions } = requestOptions;
    const maxRetries = Number(requestMaxRetries ?? process.env.LLM_MAX_RETRIES ?? 2);
    const baseDelay = Number(process.env.LLM_RETRY_BASE_MS || 800);
    const timeout = Number(process.env.LLM_TIMEOUT_MS || 90000);
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
            return await getLlmClient().chat.completions.create({
                model: getRequiredEnv('LLM_MODEL'),
                ...options,
            }, {
                timeout,
                ...sdkRequestOptions,
            });
        } catch (error) {
            lastError = error;
            if (attempt >= maxRetries || !isRetryableError(error)) break;
            const delay = baseDelay * (2 ** attempt) + Math.floor(Math.random() * 250);
            console.warn(`[LLM] Chat completion failed; retrying in ${delay}ms (${attempt + 1}/${maxRetries}).`, error.message);
            await sleep(delay);
        }
    }

    throw lastError;
};

const createVisionCompletion = async (options, requestOptions = {}) => {
    const { maxRetries: requestMaxRetries, ...sdkRequestOptions } = requestOptions;
    const maxRetries = Number(requestMaxRetries ?? process.env.LLM_MAX_RETRIES ?? 2);
    const baseDelay = Number(process.env.LLM_RETRY_BASE_MS || 800);
    const timeout = Number(process.env.LLM_TIMEOUT_MS || 90000);
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
            return await getLlmClient().chat.completions.create({
                model: process.env.VISION_MODEL_NAME || 'Qwen/Qwen2.5-VL-7B-Instruct',
                ...options,
            }, {
                timeout,
                ...sdkRequestOptions,
            });
        } catch (error) {
            lastError = error;
            if (attempt >= maxRetries || !isRetryableError(error)) break;
            const delay = baseDelay * (2 ** attempt) + Math.floor(Math.random() * 250);
            console.warn(`[LLM] Vision completion failed; retrying in ${delay}ms (${attempt + 1}/${maxRetries}).`, error.message);
            await sleep(delay);
        }
    }

    throw lastError;
};

module.exports = {
    createChatCompletion,
    createVisionCompletion,
};
