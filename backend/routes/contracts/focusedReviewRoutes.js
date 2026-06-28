/**
 * @file routes/contracts/focusedReviewRoutes.js
 * @brief 合同专项审查历史记录的查询与删除路由
 *
 * 核心职责：
 * - 获取指定合同的专项审查历史列表（最多 50 条）
 * - 删除指定的专项审查记录
 *
 * 关键实现：
 * - 查询结果按创建时间倒序
 * - 删除操作校验用户归属权
 *
 * 依赖关系：
 * - 上游：database、services/contractAnalysis/auth
 * - 下游：被 routes/contracts/index.js 注册
 */
const db = require('../../database');
const { requireRequestUserId, findOwnedContract } = require('../../services/contractAnalysis/auth');

module.exports = function (router) {
    // 获取某合同的专项审查历史
    router.get('/:id/focused-reviews', async (req, res) => {
        const userId = requireRequestUserId(req, res);
        if (!userId) return;
        try {
            const contract = await findOwnedContract(req.params.id, userId);
            if (!contract) return res.status(404).json({ error: 'Contract not found.' });

            const rows = await db('focused_reviews')
                .where({ contract_id: Number(req.params.id) })
                .orderBy('created_at', 'desc')
                .limit(50)
                .select('id', 'source_text', 'question', 'perspective', 'contract_type', 'result', 'created_at');

            const items = rows.map((row) => {
                let parsed = {};
                try { parsed = JSON.parse(row.result); } catch { parsed = {}; }
                return {
                    id: row.id,
                    source_text: row.source_text,
                    question: row.question,
                    perspective: row.perspective,
                    contract_type: row.contract_type,
                    result: parsed,
                    created_at: row.created_at,
                };
            });
            res.json({ items });
        } catch (error) {
            console.error('[ERROR] List focused reviews failed:', error);
            res.status(500).json({ error: 'Failed to list focused reviews.' });
        }
    });

    // 删除某条专项审查记录
    router.delete('/focused-reviews/:reviewId', async (req, res) => {
        const userId = requireRequestUserId(req, res);
        if (!userId) return;
        try {
            const reviewId = Number(req.params.reviewId);
            if (!Number.isInteger(reviewId) || reviewId <= 0) {
                return res.status(400).json({ error: 'Invalid review id.' });
            }
            const deleted = await db('focused_reviews').where({ id: reviewId, user_id: userId }).del();
            if (!deleted) return res.status(404).json({ error: 'Focused review not found.' });
            res.json({ ok: true });
        } catch (error) {
            console.error('[ERROR] Delete focused review failed:', error);
            res.status(500).json({ error: 'Failed to delete focused review.' });
        }
    });
};
