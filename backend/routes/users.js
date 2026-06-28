/**
 * @file routes/users.js
 * @brief 用户路由,提供指纹识别与用户合同审查历史查询
 *
 * 核心职责：
 * - /identify 基于浏览器指纹识别用户,不存在则自动创建
 * - /:userId/history 返回指定用户的合同审查历史列表
 *
 * 关键实现：
 * - users 表以 fingerprint_id 唯一标识用户,无需账号密码
 * - history 接口按 created_at desc 排序,仅返回必要字段
 *
 * 依赖关系：
 * - 上游：express、database、iconv-lite
 * - 下游：被 index.js 挂载到 /api/users
 */

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
        return res.status(400).json({ error: 'User ID is required.' });
    }
    try {
        const contracts = await db('contracts')
            .where({ user_id: userId })
            .select('id', 'original_filename', 'status', 'created_at')
            .orderBy('created_at', 'desc');
            console.debug(contracts);
        
        // Decode filenames before sending to the client
        const history = contracts.map(c => ({
            ...c,
            original_filename: c.original_filename
        }));
        
        res.json(history);
    } catch (error) {
        console.error(`Error fetching history for user ${userId}:`, error);
        res.status(500).json({ error: 'Failed to retrieve history.' });
    }
});


module.exports = router; 