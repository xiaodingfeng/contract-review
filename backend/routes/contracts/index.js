/**
 * @file routes/contracts/index.js
 * @brief 合同路由聚合入口，按固定顺序注册所有子路由模块
 *
 * 核心职责：
 * - 按定义顺序注册 9 个子路由模块（上传、分组、分析等）
 * - 导出 setIoInstance 方法供外部注入 Socket.IO 实例
 *
 * 关键实现：
 * - 子路由注册顺序严格匹配 Express 路由优先级
 * - crudRoutes 必须最后注册（包含 /:id 和 / 通配路由）
 *
 * 依赖关系：
 * - 上游：services/contractAnalysis/analysisJob
 * - 下游：app.js 或主路由文件
 */
const express = require('express');
const router = express.Router();
const { setIoInstance } = require('../../services/contractAnalysis/analysisJob');

// Register routes in EXACT order (Express matches routes in definition order)
require('./uploadRoutes')(router);
require('./groupRoutes')(router);
require('./analyzeRoutes')(router);
require('./focusedReviewRoutes')(router);
require('./textEditRoutes')(router);
require('./incrementalRoutes')(router);
require('./versionRoutes')(router);
require('./exportRoutes')(router);
require('./crudRoutes')(router); // MUST be last - contains catch-all /:id and / routes

module.exports = router;
module.exports.setIoInstance = setIoInstance;
