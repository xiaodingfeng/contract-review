const db = require('./database');
const { ensureVectorStore, seedLawsFromMarkdown, seedCasesFromJson } = require('./services/vectorStore');

async function ensureColumn(tableName, columnName, addColumn) {
  const exists = await db.schema.hasColumn(tableName, columnName);
  if (!exists) {
    console.log(`[DB Init] Adding ${tableName}.${columnName}...`);
    await db.schema.table(tableName, addColumn);
  }
}

async function resetAndRebuildDatabase() {
  console.log('[DB Init] Starting database schema verification and rebuild...');
  try {
    const hasUsersTable = await db.schema.hasTable('users');
    if (!hasUsersTable) {
        console.log('[DB Init] Creating new `users` table...');
        await db.schema.createTable('users', (table) => {
            table.increments('id').primary();
            table.string('fingerprint_id').notNullable().unique();
            table.timestamps(true, true);
        });
        console.log('[DB Init] New `users` table created successfully.');
    }

    const hasContractsTable = await db.schema.hasTable('contracts');
    
    if (hasContractsTable) {
      // Table already exists, so we do nothing.
      // The logic in database.js will handle any necessary column additions.
      console.log('[DB Init] `contracts` table already exists. Skipping creation.');
    } else {
      // Only create the table if it does not exist.
      console.log('[DB Init] Creating new `contracts` table with the latest schema...');
      await db.schema.createTable('contracts', (table) => {
        table.increments('id').primary();
        table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
        table.string('original_filename').notNullable();
        table.string('storage_path').notNullable();
        table.string('document_key').unique();
        table.string('perspective'); // To store the user's review perspective (e.g., '甲方')
        table.text('analysis_result'); // To store the JSON result from the AI analysis
        table.text('pre_analysis_data'); // To store the full payload from the pre-analysis/setup step
        table.string('status'); // To track the contract's state (e.g., 'Uploaded', 'Reviewed')
        table.text('pre_analysis_cache'); // Add column to cache pre-analysis results
        table.timestamps(true, true);
      });
      console.log('[DB Init] New `contracts` table created successfully. Schema is now up-to-date.');
    }

    await ensureColumn('contracts', 'analysis_partial_result', (table) => table.text('analysis_partial_result'));
    await ensureColumn('contracts', 'analysis_status', (table) => table.string('analysis_status'));
    await ensureColumn('contracts', 'group_id', (table) => table.integer('group_id').unsigned());

    const hasContractVersionsTable = await db.schema.hasTable('contract_versions');
    if (!hasContractVersionsTable) {
      console.log('[DB Init] Creating new `contract_versions` table...');
      await db.schema.createTable('contract_versions', (table) => {
        table.increments('id').primary();
        table.integer('contract_id').unsigned().notNullable().references('id').inTable('contracts').onDelete('CASCADE');
        table.integer('user_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
        table.integer('version_no').notNullable();
        table.string('source_action').notNullable();
        table.string('storage_path');
        table.text('plain_text');
        table.timestamps(true, true);
        table.index(['contract_id', 'version_no']);
      });
    }

    const hasContractGroupsTable = await db.schema.hasTable('contract_groups');
    if (!hasContractGroupsTable) {
      console.log('[DB Init] Creating new `contract_groups` table...');
      await db.schema.createTable('contract_groups', (table) => {
        table.increments('id').primary();
        table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
        table.string('name').notNullable();
        table.text('analysis_result');
        table.string('status');
        table.timestamps(true, true);
      });
    }
    await ensureColumn('contract_groups', 'analysis_result', (table) => table.text('analysis_result'));
    await ensureColumn('contract_groups', 'status', (table) => table.string('status'));

    const hasQaHistoryTable = await db.schema.hasTable('qa_history');
    if (!hasQaHistoryTable) {
        console.log('[DB Init] Creating new `qa_history` table...');
        await db.schema.createTable('qa_history', (table) => {
            table.increments('id').primary();
            table.string('session_id').notNullable().index();
            table.string('role').notNullable();
            table.text('content').notNullable();
            table.integer('contract_id').unsigned().references('id').inTable('contracts').onDelete('SET NULL');
            table.timestamps(true, true);
        });
        console.log('[DB Init] New `qa_history` table created successfully.');
    }

    await ensureVectorStore();
    await seedLawsFromMarkdown();
    await seedCasesFromJson();
    console.log('[DB Init] Vector knowledge index is ready.');

  } catch (error) {
    console.error("[DB Init] FATAL: Failed to rebuild database schema:", error);
    process.exit(1); // Exit if we can't build the database
  }
}

// Rename the exported function for clarity
module.exports = resetAndRebuildDatabase; 
