const express = require('express');
const router = express.Router();
const db = require('../database');
const axios = require('axios');

// GET /api/qa/history
// Gets the entire Q&A history
router.get('/history', async (req, res) => {
    try {
        const history = await db('qa_history').orderBy('created_at', 'asc');
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve Q&A history.' });
    }
});

// POST /api/qa/ask
// Asks a question to the AI
router.post('/ask', async (req, res) => {
    const { question, sessionId } = req.body;
    if (!question) {
        return res.status(400).json({ error: 'Question is required.' });
    }

    try {
        // Save user question to DB
        await db('qa_history').insert({
            session_id: sessionId,
            role: 'user',
            content: question,
        });

        // --- Call Ollama for answer ---
        // For a better chat experience, you should include previous messages as context.
        // This is a simplified example.
        const prompt = `你是一个专业的法律合同AI助手。请回答用户的问题。\n用户问题: ${question}`;

        const ollamaResponse = await axios.post('http://127.0.0.1:11434/api/generate', {
            model: "llama3.2:latest",
            prompt: prompt,
            stream: false
        });
        
        const aiResponse = ollamaResponse.data.response;
        // ---------------------------------

        // Save AI response to DB
        await db('qa_history').insert({
            session_id: sessionId,
            role: 'assistant',
            content: aiResponse,
        });

        res.json({ answer: aiResponse });

    } catch (error) {
        console.error("Error in /ask endpoint:", error.message);
        res.status(500).json({ error: 'Failed to process question.' });
    }
});


module.exports = router; 