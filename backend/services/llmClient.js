const { OpenAI } = require('openai');

let llmClient;

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

const createChatCompletion = (options) => getLlmClient().chat.completions.create({
    model: getRequiredEnv('LLM_MODEL'),
    ...options,
});

module.exports = {
    createChatCompletion,
};
