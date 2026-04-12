const express = require('express');
const mammoth = require('mammoth');
const path = require('path');
const fs = require('fs');
const pdf = require('pdf-parse');
const db = require('../database');
const { searchVectorDocuments } = require('../services/vectorStore');
const { searchWeb } = require('../services/webSearch');
const { createChatCompletion } = require('../services/llmClient');

const router = express.Router();

const MAX_HISTORY_MESSAGES = Number(process.env.QA_MAX_HISTORY_MESSAGES || 12);
const MAX_HISTORY_CHARS = Number(process.env.QA_MAX_HISTORY_CHARS || 4000);

const PUBLIC_WEB_TERMS = [
    '\u516c\u53f8', // company
    '\u4e3b\u4f53', // entity
    '\u5de5\u5546', // business registration
    '\u4fe1\u7528', // credit
    '\u767b\u8bb0', // registration
    '\u6cd5\u5b9a\u4ee3\u8868\u4eba',
    '\u88c1\u5224\u6587\u4e66',
    '\u6848\u4f8b',
    '\u6700\u65b0',
    '\u5f53\u524d',
    '\u641c\u7d22',
    '\u8054\u7f51',
    'Bing',
    'Google',
];

const BLOCKED_WEB_TERMS = [
    '\u5bc6\u7801',
    '\u8eab\u4efd\u8bc1',
    '\u94f6\u884c\u5361',
    '\u624b\u673a\u53f7',
    '\u4f4f\u5740',
    '\u9690\u79c1',
    '\u5185\u90e8\u6587\u4ef6',
    '\u7ed5\u8fc7',
    '\u653b\u51fb',
    '\u6f0f\u6d1e',
];

const includesAny = (text, terms) => terms.some((term) => String(text || '').includes(term));

const extractTextFromFile = async (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.docx') {
        const { value } = await mammoth.extractRawText({ path: filePath });
        return value;
    }
    if (ext === '.pdf') {
        const data = await pdf(fs.readFileSync(filePath));
        return data.text;
    }
    return '';
};

const normalizeHistory = (history = []) => {
    if (!Array.isArray(history)) return [];
    return history
        .filter((item) => ['user', 'assistant'].includes(item?.role))
        .map((item) => ({
            role: item.role,
            content: String(item.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim().slice(0, MAX_HISTORY_CHARS),
        }))
        .filter((item) => item.content)
        .slice(-MAX_HISTORY_MESSAGES);
};

const buildHistoryAwareQuery = (question, history) => {
    const recentUserQuestions = normalizeHistory(history)
        .filter((item) => item.role === 'user')
        .slice(-3)
        .map((item) => item.content)
        .join('\n');
    return [recentUserQuestions, question].filter(Boolean).join('\n');
};

const shouldUseWebSearch = (question, knowledgeResults) => {
    if (includesAny(question, BLOCKED_WEB_TERMS)) return false;
    if (knowledgeResults.length < 2) return true;
    if (/\b(latest|current|today|web|internet|search|company|registration|case)\b/i.test(String(question || ''))) {
        return true;
    }
    return includesAny(question, PUBLIC_WEB_TERMS);
};

const buildQaKnowledgeQuery = (question, contextText, history = []) => {
    const normalizedQuestion = String(buildHistoryAwareQuery(question, history)).replace(/\s+/g, ' ').trim();
    const contractExcerpt = String(contextText || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 2500);
    return [
        normalizedQuestion,
        contractExcerpt ? `Contract context: ${contractExcerpt}` : '',
    ].filter(Boolean).join('\n');
};

const buildSystemPrompt = () => [
    'You are a professional and careful legal contract Q&A assistant.',
    'Answer in the same language as the user unless they ask otherwise.',
    'Available server-side tools are already executed before you respond: knowledge_base_search and public_web_search.',
    'Do not claim you can execute arbitrary tools, access local files, databases, credentials, private systems, or internal networks.',
    'Use the current conversation history to resolve follow-up questions and pronouns.',
    'Do not invent statutes, article numbers, case names, court views, company registration data, or contract content.',
    'Legal provisions, case documents, and internal rules must come from the provided knowledge base results. If evidence is insufficient, say that the current knowledge base did not retrieve enough support.',
    'Public web search results are only clues. If a result is verified=false, do not use it as a confirmed conclusion.',
    'For company/entity checks, tell the user to verify final facts through official channels such as the National Enterprise Credit Information Publicity System, regulators, or court websites.',
    'For private personal data, credentials, security bypasses, or offensive requests, refuse that part and suggest a lawful verification channel.',
].join('\n');

const buildEvidencePrompt = ({ contextText, knowledgeResults, webResults, toolTrace }) => {
    const knowledgeContext = knowledgeResults.map((item, index) => {
        const typeName = item.source_type === 'case' ? 'case_document' : item.source_type === 'rule' ? 'review_rule' : 'law';
        return `[K${index + 1}] ${typeName} ${item.title}${item.clause_id ? ` ${item.clause_id}` : ''}: ${item.content}`;
    }).join('\n');

    const webContext = webResults.map((item, index) => (
        `[W${index + 1}] [${item.engine}] ${item.title}\n`
        + `URL: ${item.url}\n`
        + `trust_score: ${item.authenticity_score} ${item.verified ? 'verified=true' : 'verified=false'}\n`
        + `verification_basis: ${(item.verification_basis || []).join(', ') || 'none'}\n`
        + `snippet: ${item.snippet}`
    )).join('\n');

    return [
        'Evidence for this turn:',
        `Tool trace: ${toolTrace.map((item) => `${item.name}=${item.status}`).join(', ')}`,
        '',
        'Selected contract content:',
        contextText ? `---\n${contextText.slice(0, 15000)}\n---` : 'No contract selected.',
        '',
        'Knowledge base search results:',
        knowledgeContext || 'No matching laws, case documents, or review rules were retrieved.',
        '',
        'Public web search results:',
        webContext || 'Public web search was not triggered, blocked by safety policy, or returned no usable results.',
    ].join('\n');
};

const buildQaContext = async ({ question, contractId, history = [] }) => {
    let contextText = '';
    if (contractId) {
        const contract = await db('contracts').where({ id: contractId }).first();
        if (contract) contextText = await extractTextFromFile(contract.storage_path);
    }

    const normalizedHistory = normalizeHistory(history);
    const knowledgeResults = await searchVectorDocuments(buildQaKnowledgeQuery(question, contextText, normalizedHistory), {
        limit: 8,
        sourceTypes: ['law', 'case', 'rule'],
    });

    const toolTrace = [{
        name: 'knowledge_base_search',
        status: `completed:${knowledgeResults.length}`,
    }];

    let webResults = [];
    if (shouldUseWebSearch(question, knowledgeResults)) {
        const searchQuery = buildHistoryAwareQuery(question, normalizedHistory).slice(-1200);
        webResults = await searchWeb(searchQuery, { count: 5 });
        toolTrace.push({ name: 'public_web_search', status: `completed:${webResults.length}` });
    } else {
        toolTrace.push({ name: 'public_web_search', status: 'skipped' });
    }

    const llmMessages = [
        { role: 'system', content: buildSystemPrompt() },
        ...normalizedHistory,
        { role: 'system', content: buildEvidencePrompt({ contextText, knowledgeResults, webResults, toolTrace }) },
        { role: 'user', content: question },
    ];

    return { llmMessages, knowledgeResults, webResults, toolTrace };
};

const saveMessage = (sessionId, role, content, contractId) => db('qa_history').insert({
    session_id: sessionId,
    role,
    content,
    contract_id: contractId || null,
});

router.get('/history/:sessionId', async (req, res) => {
    try {
        const history = await db('qa_history')
            .where({ session_id: req.params.sessionId })
            .orderBy('created_at', 'asc');
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve Q&A history.' });
    }
});

router.post('/ask', async (req, res) => {
    const { question, sessionId, contractId, history = [] } = req.body;
    if (!question) return res.status(400).json({ error: 'Question is required.' });

    try {
        await saveMessage(sessionId, 'user', question, contractId);
        const { llmMessages, webResults, toolTrace } = await buildQaContext({ question, contractId, history });
        const completion = await createChatCompletion({
            messages: llmMessages,
        });
        const answer = String(completion.choices[0].message.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        await saveMessage(sessionId, 'assistant', answer, contractId);
        res.json({
            answer,
            meta: {
                webSearchUsed: webResults.length > 0,
                verifiedWebResults: webResults.filter((item) => item.verified).length,
                tools: toolTrace,
            },
        });
    } catch (error) {
        console.error('Error in /ask endpoint:', error);
        res.status(500).json({ error: 'Failed to process question.' });
    }
});

router.post('/ask-stream', async (req, res) => {
    const { question, sessionId, contractId, history = [] } = req.body;
    if (!question) return res.status(400).json({ error: 'Question is required.' });

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (event, data) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        await saveMessage(sessionId, 'user', question, contractId);
        const { llmMessages, webResults, toolTrace } = await buildQaContext({ question, contractId, history });
        send('meta', {
            webSearchUsed: webResults.length > 0,
            verifiedWebResults: webResults.filter((item) => item.verified).length,
            tools: toolTrace,
        });

        let answer = '';
        const stream = await createChatCompletion({
            stream: true,
            messages: llmMessages,
        });
        for await (const chunk of stream) {
            const content = chunk.choices?.[0]?.delta?.content || '';
            if (!content) continue;
            answer += content;
            send('delta', { content });
        }

        answer = answer.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        await saveMessage(sessionId, 'assistant', answer, contractId);
        send('done', { answer });
        res.end();
    } catch (error) {
        console.error('Error in /ask-stream endpoint:', error);
        send('error', { error: 'Failed to process question.' });
        res.end();
    }
});

module.exports = router;
