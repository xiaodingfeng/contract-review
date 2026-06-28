/**
 * @file services/vectorStore/config.js
 * @brief 向量库统一配置与 Milvus 连接单例状态
 *
 * 核心职责：
 * - 集中管理 collection 名、向量字段、知识库 seed 目录等常量
 * - 持有 Milvus 连接单例状态，供 milvusStore 写入、index.js 读取
 * - 提供环境变量驱动的 seed 开关与批量大小配置
 *
 * 关键实现：
 * - state 对象持有可变状态，利用模块缓存保证多模块共享同一引用
 * - 知识库类型与 seed 目录均可通过环境变量覆盖
 *
 * 依赖关系：
 * - 上游：path、环境变量
 * - 下游：被 vectorStore 目录所有子模块共享
 */
const path = require('path');

// 向量库统一配置：Milvus collection 名、向量字段、知识库 seed 目录与开关
// 所有子模块共享同一份常量与 Milvus 连接单例状态，避免多实例导致连接泄漏
const lawsMarkdownDir = path.join(__dirname, '..', '..', 'data', 'laws');
const caseJsonDir = path.join(__dirname, '..', '..', 'data', 'candidate_55192');
const COLLECTION_NAME = process.env.MILVUS_COLLECTION || 'contract_review_knowledge';
const VECTOR_FIELD = 'embedding';
const KNOWLEDGE_SEED_TYPES = String(process.env.KNOWLEDGE_SEED_TYPES || 'law,case')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
const LAW_SEED_FILE_BATCH_SIZE = Math.max(1, Number(process.env.LAW_SEED_FILE_BATCH_SIZE || 20));
// CASE_SEED_LIMIT:未设置(空)时不限制数量,获取目录下所有文件;设为正整数时限制文件数;设为 0 表示不导入
const rawCaseSeedLimit = process.env.CASE_SEED_LIMIT;
const CASE_SEED_LIMIT = (rawCaseSeedLimit === undefined || rawCaseSeedLimit === '')
    ? null
    : Math.max(0, Number(rawCaseSeedLimit));
const MILVUS_CONNECT_TIMEOUT_MS = Number(process.env.MILVUS_CONNECT_TIMEOUT_MS || 3000);

// Milvus 连接单例状态：milvusStore 写入，index.js 读取以判定返回 vectorStore 来源
// 使用对象持有可变状态，保证多模块间共享同一份引用（Node.js 模块缓存对象引用）
const state = {
    milvusClientPromise: null,
    milvusReady: false,
};

module.exports = {
    lawsMarkdownDir,
    caseJsonDir,
    COLLECTION_NAME,
    VECTOR_FIELD,
    KNOWLEDGE_SEED_TYPES,
    LAW_SEED_FILE_BATCH_SIZE,
    CASE_SEED_LIMIT,
    MILVUS_CONNECT_TIMEOUT_MS,
    state,
};
