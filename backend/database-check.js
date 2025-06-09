const db = require('./database');

async function resetAndRebuildDatabase() {
  console.log('[DB Init] Starting database schema verification and rebuild...');
  try {
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

  } catch (error) {
    console.error("[DB Init] FATAL: Failed to rebuild database schema:", error);
    process.exit(1); // Exit if we can't build the database
  }
}

// Rename the exported function for clarity
module.exports = resetAndRebuildDatabase; 