/**
 * @file database.js
 * @brief 创建并导出 PostgreSQL 数据库连接(Knex 实例)
 *
 * 核心职责：
 * - 读取环境变量构造 PostgreSQL 连接配置
 * - 创建 Knex 实例并配置连接池参数
 * - 导出 Knex 实例供全局复用
 *
 * 关键实现：
 * - 优先使用 DATABASE_URL,否则使用分项 POSTGRES_* 环境变量
 * - 连接池 min/max 由 DB_POOL_MIN/DB_POOL_MAX 控制
 * - Schema 初始化逻辑已迁移至 database-check.js,本文件仅负责连接
 *
 * 依赖关系：
 * - 上游：knex、dotenv 提供的环境变量
 * - 下游：被 routes、services、database-check 等几乎所有业务模块引用
 */

const knex = require('knex')({
  client: 'pg',
  connection: process.env.DATABASE_URL || {
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER || 'contract_review',
    password: process.env.POSTGRES_PASSWORD || 'contract_review',
    database: process.env.POSTGRES_DB || 'contract_review',
  },
  pool: {
    min: Number(process.env.DB_POOL_MIN || 0),
    max: Number(process.env.DB_POOL_MAX || 10),
  },
});

// All database schema setup logic (setupDatabase function and its call) 
// has been moved to database-check.js to centralize schema management 
// and prevent initialization conflicts. This file is now only responsible 
// for creating and exporting the database connection.

module.exports = knex; 
