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
    const maxRetries = Number(process.env.LLM_MAX_RETRIES || 2);
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
                ...requestOptions,
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

module.exports = {
    createChatCompletion,
};
