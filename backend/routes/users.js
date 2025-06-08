const express = require('express');
const router = express.Router();
const db = require('../database');
const iconv = require('iconv-lite');

// POST /api/users/identify
// Identifies a user by their fingerprint. Creates a new user if not found.
router.post('/identify', async (req, res) => {
    const { fingerprintId } = req.body;
    if (!fingerprintId) {
        return res.status(400).json({ error: 'Fingerprint ID is required.' });
    }

    try {
        let user = await db('users').where({ fingerprint_id: fingerprintId }).first();
        if (user) {
            res.json({ userId: user.id, isNew: false });
        } else {
            const [newUserId] = await db('users').insert({ fingerprint_id: fingerprintId }).returning('id');
            res.status(201).json({ userId: newUserId.id, isNew: true });
        }
    } catch (error) {
        console.error('[ERROR] User identification failed:', error);
        res.status(500).json({ error: 'Failed to identify or create user.' });
    }
});

// GET /api/users/:userId/history
// Gets the contract review history for a specific user.
router.get('/:userId/history', async (req, res) => {
    const { userId } = req.params;
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }
    try {
        const history = await db('contracts')
            .where({ user_id: userId })
            .select('id', 'original_filename', 'status', 'created_at')
            .orderBy('created_at', 'desc');
        
        // Manually decode filenames from binary buffer to UTF-8 string
        const decodedHistory = history.map(item => ({
            ...item,
            original_filename: iconv.decode(Buffer.from(item.original_filename, 'binary'), 'utf-8')
        }));
        
        res.json(decodedHistory);
    } catch (error) {
        console.error(`[ERROR] Failed to get history for user ${userId}:`, error);
        res.status(500).json({ error: 'Failed to retrieve history.' });
    }
});


module.exports = router; 