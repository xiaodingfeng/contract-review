const knex = require('knex')({
  client: 'sqlite3',
  connection: {
    filename: './contracts.db',
  },
  useNullAsDefault: true,
});

// All database schema setup logic (setupDatabase function and its call) 
// has been moved to database-check.js to centralize schema management 
// and prevent initialization conflicts. This file is now only responsible 
// for creating and exporting the database connection.

module.exports = knex; 