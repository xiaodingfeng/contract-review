/**
 * @file services/contractAnalysis/auth.js
 * @brief 提供请求级的用户身份识别与合同归属校验工具函数
 *
 * 核心职责：
 * - 从请求头/请求体/查询参数中提取并校验用户 ID
 * - 未通过鉴权时返回 401 错误
 * - 校验合同是否归属于当前用户，防止越权访问
 *
 * 关键实现：
 * - 通过 X-User-ID 头部优先，兼容 body/query 传入的 userId
 * - 基于 contracts 表 user_id 字段做归属查询
 *
 * 依赖关系：
 * - 上游：../../database（Knex 实例）
 * - 下游：被各合同相关 API 路由作为鉴权中间件调用
 */
const db = require('../../database');

const getRequestUserId = (req) => {
    const raw = req.header('X-User-ID') || req.body?.userId || req.query?.userId;
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
};

const requireRequestUserId = (req, res) => {
    const userId = getRequestUserId(req);
    if (!userId) {
        res.status(401).json({ error: 'User ID is required for access.' });
        return null;
    }
    return userId;
};

const findOwnedContract = (id, userId) => db('contracts').where({ id, user_id: userId }).first();

module.exports = {
    getRequestUserId,
    requireRequestUserId,
    findOwnedContract,
};
