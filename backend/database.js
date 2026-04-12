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
