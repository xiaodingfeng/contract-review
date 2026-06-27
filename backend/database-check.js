const db = require('./database');
const { ensureVectorStore } = require('./services/vectorStore');

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

    const hasFocusedReviewsTable = await db.schema.hasTable('focused_reviews');
    if (!hasFocusedReviewsTable) {
        console.log('[DB Init] Creating new `focused_reviews` table...');
        await db.schema.createTable('focused_reviews', (table) => {
            table.increments('id').primary();
            table.integer('contract_id').unsigned().notNullable().references('id').inTable('contracts').onDelete('CASCADE');
            table.integer('user_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
            table.text('source_text').notNullable();
            table.string('question');
            table.string('perspective');
            table.string('contract_type');
            table.string('template_id');
            table.text('result').notNullable(); // JSON string of the focused review result
            table.timestamps(true, true);
            table.index(['contract_id', 'created_at']);
        });
        console.log('[DB Init] New `focused_reviews` table created successfully.');
    }

    // 法律版本管理表(P0 法律时效性监控):记录每部法律的所有版本时间线
    const hasLawVersionsTable = await db.schema.hasTable('law_versions');
    if (!hasLawVersionsTable) {
        console.log('[DB Init] Creating new `law_versions` table...');
        await db.schema.createTable('law_versions', (table) => {
            table.increments('id').primary();
            table.string('title').notNullable();               // 法律名称
            table.string('version_label');                     // 版本标识(如 2020版 / 修正版)
            table.date('effective_date');                      // 施行日期
            table.integer('superseded_by');                    // 被替代关系:指向新版本 id
            table.string('status').defaultTo('现行');           // 现行 / 已修订 / 已废止
            table.text('source_url');                          // 源 URL
            table.text('raw_markdown');                        // 原始 Markdown
            table.timestamp('synced_at').defaultTo(db.fn.now()); // 同步时间
            table.unique(['title', 'version_label']);
        });
        console.log('[DB Init] New `law_versions` table created successfully.');
    }

    // 行业标准条款库表(P3 4.3):存储用户/公共标准条款,审查时自动对比
    // embedding 不在此表存,而是通过 vectorStore 入库到 vector_documents 表(source_type='standard_clause')
    const hasStandardClausesTable = await db.schema.hasTable('standard_clauses');
    if (!hasStandardClausesTable) {
        console.log('[DB Init] Creating new `standard_clauses` table...');
        await db.schema.createTable('standard_clauses', (table) => {
            table.increments('id').primary();
            table.string('category').notNullable();            // confidentiality/breach/ip/dispute/force_majeure/...
            table.string('title');                             // 条款标题
            table.text('clause_text').notNullable();           // 条款正文
            table.string('industry');                          // 互联网/制造业/央企/通用
            table.string('owner_type').defaultTo('private');   // private/public
            table.integer('owner_user_id');                    // private 时记录 owner
            table.jsonb('applicable_contract_types');          // ["service","nda",...]
            table.integer('version').defaultTo(1);             // 版本号
            table.jsonb('metadata');                           // 扩展元数据
            table.timestamp('created_at').defaultTo(db.fn.now());
            table.timestamp('updated_at').defaultTo(db.fn.now());
        });
        console.log('[DB Init] New `standard_clauses` table created successfully.');
    }

    // 审查模板管理表(P1 Task 3):存储审查模板的在线管理数据,支持 CRUD 与版本快照
    const hasReviewTemplatesTable = await db.schema.hasTable('review_templates');
    if (!hasReviewTemplatesTable) {
        console.log('[DB Init] Creating new `review_templates` table...');
        await db.schema.createTable('review_templates', (table) => {
            table.string('id', 64).primary();
            table.string('name', 128).notNullable();
            table.jsonb('contract_type_keywords').notNullable();
            table.jsonb('review_points').notNullable();
            table.jsonb('core_purposes').notNullable();
            table.jsonb('report_sections').notNullable();
            table.jsonb('prompt_rules').notNullable();
            table.text('typical_description');
            table.text('typical_description_embedding'); // 存 JSON 数组字符串,用于语义匹配
            table.boolean('is_active').defaultTo(true);
            table.boolean('is_system').defaultTo(false); // 系统模板(seed 导入)不可删除
            table.timestamp('created_at').defaultTo(db.fn.now());
            table.timestamp('updated_at').defaultTo(db.fn.now());
        });
        console.log('[DB Init] New `review_templates` table created successfully.');
    }

    // 模板版本快照表(P1 Task 3):每次编辑前写入当前状态快照,支持回滚
    const hasTemplateVersionsTable = await db.schema.hasTable('template_versions');
    if (!hasTemplateVersionsTable) {
        console.log('[DB Init] Creating new `template_versions` table...');
        await db.schema.createTable('template_versions', (table) => {
            table.increments('id').primary();
            table.string('template_id', 64).notNullable();
            table.integer('version').notNullable();
            table.jsonb('snapshot').notNullable(); // 编辑前的完整模板快照
            table.string('changed_by', 64);
            table.timestamp('created_at').defaultTo(db.fn.now());
            table.unique(['template_id', 'version']);
        });
        console.log('[DB Init] New `template_versions` table created successfully.');
    }

    await ensureVectorStore();
    console.log('[DB Init] Vector store tables created. Vector index will be built from the knowledge base page.');

    // 法律时效性字段扩展:为 vector_documents 表追加 law_status/superseded_by/effective_date
    // 旧数据 law_status 默认 '现行',不破坏现有检索;此处 ensureColumn 幂等,与 vectorStore.js 内部 addColumn 互为兜底
    await ensureColumn('vector_documents', 'law_status', (table) => table.string('law_status').defaultTo('现行'));
    await ensureColumn('vector_documents', 'superseded_by', (table) => table.string('superseded_by'));
    await ensureColumn('vector_documents', 'effective_date', (table) => table.date('effective_date'));

  } catch (error) {
    console.error("[DB Init] FATAL: Failed to rebuild database schema:", error);
    process.exit(1); // Exit if we can't build the database
  }
}

// Rename the exported function for clarity
module.exports = resetAndRebuildDatabase; 
