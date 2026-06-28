/**
 * @file routes/standards.js
 * @brief 行业标准条款库路由,提供标准条款 CRUD 与相似度对比
 *
 * 核心职责：
 * - 提供标准条款的列表、创建、编辑、删除、相似度对比接口
 * - 启动时 seed 公共库(保密/违约/知识产权/争议解决/不可抗力 5 类)
 * - 区分公共库与私有库,私有库仅 owner 可编辑/删除
 * - 条款变更同步写入向量库,供审查时自动对比提示差异
 *
 * 关键实现：
 * - 通过 X-User-ID 头/请求体识别用户,requireUserId 强制鉴权
 * - 编辑/删除接口校验 owner_type=private 且 owner_user_id 一致
 * - /compare 接口调用 searchVectorDocumentsMulti 返回 top-N 相似条款
 * - embedding 通过 vectorStore.importKnowledgeEntries 入库到 vector_documents(source_type='standard_clause')
 *
 * 依赖关系：
 * - 上游：express、database、services/vectorStore
 * - 下游：被 index.js 挂载到 /api/standards
 */

const express = require('express');
const db = require('../database');
const { importKnowledgeEntries, deleteKnowledgeDocuments, searchVectorDocumentsMulti } = require('../services/vectorStore');

const router = express.Router();

const getRequestUserId = (req) => {
    const raw = req.header('X-User-ID') || req.body?.userId || req.query?.userId;
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
};

const requireUserId = (req, res) => {
    const userId = getRequestUserId(req);
    if (!userId) {
        res.status(401).json({ error: 'User ID is required.' });
        return null;
    }
    return userId;
};

// 公共库 seed 数据:5 类典型行业标准条款
const PUBLIC_SEED_CLAUSES = [
    {
        category: 'confidentiality',
        title: '保密义务标准条款',
        clause_text: '乙方对在合作过程中知悉的甲方商业秘密、技术资料、客户信息等承担保密义务,保密期限自合同终止之日起延续三年。未经甲方书面同意,乙方不得向任何第三方披露、使用或允许他人使用上述信息。违反保密义务的,应支付违约金人民币五十万元,并赔偿甲方因此遭受的全部损失。',
        industry: '通用',
        applicable_contract_types: ['service', 'nda', 'employment'],
    },
    {
        category: 'breach',
        title: '违约责任标准条款',
        clause_text: '任何一方违反本合同约定的义务,应向守约方支付违约金,违约金金额为合同总金额的百分之二十。违约金不足以弥补守约方损失的,违约方还应赔偿差额部分。守约方有权选择要求违约方继续履行、采取补救措施或解除合同。',
        industry: '通用',
        applicable_contract_types: ['service', 'sale', 'lease'],
    },
    {
        category: 'ip',
        title: '知识产权归属标准条款',
        clause_text: '双方在合作期间共同开发的知识产权归双方共同所有,未经对方书面同意任何一方不得单独处分。一方独立开发的知识产权归该方所有。乙方基于甲方提供资料形成的衍生知识产权归甲方所有,乙方享有署名权。',
        industry: '互联网',
        applicable_contract_types: ['service', 'development', 'nda'],
    },
    {
        category: 'dispute',
        title: '争议解决标准条款',
        clause_text: '本合同履行过程中发生争议的,双方应首先通过友好协商解决;协商不成的,任何一方均可向合同签订地有管辖权的人民法院提起诉讼。合同签订地为甲方住所地。',
        industry: '通用',
        applicable_contract_types: ['service', 'sale', 'employment', 'lease'],
    },
    {
        category: 'force_majeure',
        title: '不可抗力标准条款',
        clause_text: '因不可抗力导致一方不能履行合同义务的,应在不可抗力发生后十五日内书面通知对方,并提供有效证明。不可抗力包括自然灾害、政府行为、战争、疫情等不能预见、不能避免、不能克服的客观情况。因不可抗力不能履行合同的,部分或全部免除责任,但法律另有规定的除外。',
        industry: '通用',
        applicable_contract_types: ['service', 'sale', 'lease', 'employment'],
    },
];

// 启动时若 standard_clauses 表为空,seed 公共库
const seedPublicClausesIfEmpty = async () => {
    try {
        const count = await db('standard_clauses').where({ owner_type: 'public' }).count({ count: '*' }).first();
        if (Number(count?.count || 0) > 0) return;
        console.log('[Standards] Seeding public standard clauses...');
        const entries = PUBLIC_SEED_CLAUSES.map((c) => ({
            category: c.category,
            title: c.title,
            clause_text: c.clause_text,
            industry: c.industry,
            owner_type: 'public',
            owner_user_id: null,
            applicable_contract_types: JSON.stringify(c.applicable_contract_types),
            version: 1,
            metadata: JSON.stringify({ seeded: true }),
        }));
        const inserted = await db('standard_clauses').insert(entries).returning(['id', 'title']);
        // 同步入库到 vectorStore
        const vectorEntries = inserted.map((row, idx) => ({
            source_type: 'standard_clause',
            source_id: `standard_clause:${row.id}`,
            title: PUBLIC_SEED_CLAUSES[idx].title,
            category: PUBLIC_SEED_CLAUSES[idx].category,
            content: PUBLIC_SEED_CLAUSES[idx].clause_text,
            clauseId: String(row.id),
            source_name: '行业标准条款公共库',
            metadata: {
                standard_id: row.id,
                industry: PUBLIC_SEED_CLAUSES[idx].industry,
                owner_type: 'public',
                applicable_contract_types: PUBLIC_SEED_CLAUSES[idx].applicable_contract_types,
            },
        }));
        await importKnowledgeEntries(vectorEntries);
        console.log(`[Standards] Seeded ${inserted.length} public standard clauses.`);
    } catch (error) {
        console.error('[Standards] Seed failed:', error.message);
    }
};

// 异步触发 seed,不阻塞路由加载
seedPublicClausesIfEmpty().catch((err) => console.error('[Standards] seedPublicClausesIfEmpty error:', err));

// 列表:支持 category/industry/owner 筛选;公共库全员可见,私有库仅 owner 可见
router.get('/', async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    try {
        const { category, industry, owner } = req.query;
        const query = db('standard_clauses');
        // owner=public 只查公共;owner=mine 只查私有;未指定则两者都查(私有限本人)
        if (owner === 'public') {
            query.where({ owner_type: 'public' });
        } else if (owner === 'mine') {
            query.where({ owner_type: 'private', owner_user_id: userId });
        } else {
            query.where((builder) => builder.where({ owner_type: 'public' }).orWhere({ owner_type: 'private', owner_user_id: userId }));
        }
        if (category) query.andWhere('category', category);
        if (industry) query.andWhere('industry', industry);
        const rows = await query.orderBy('created_at', 'desc');
        const items = rows.map((row) => ({
            id: row.id,
            category: row.category,
            title: row.title,
            clause_text: row.clause_text,
            industry: row.industry,
            owner_type: row.owner_type,
            owner_user_id: row.owner_user_id,
            applicable_contract_types: parseJsonSafe(row.applicable_contract_types, []),
            version: row.version,
            metadata: parseJsonSafe(row.metadata, {}),
            created_at: row.created_at,
            canEdit: row.owner_type === 'private' && row.owner_user_id === userId,
        }));
        res.json({ items });
    } catch (error) {
        console.error('[Standards] GET / failed:', error);
        res.status(500).json({ error: `查询失败:${error.message}` });
    }
});

// 创建:仅创建 private 条款(公共库只能由 seed 注入)
router.post('/', async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    try {
        const { category, title, clause_text, industry, applicable_contract_types } = req.body || {};
        if (!category || !clause_text) {
            return res.status(400).json({ error: 'category 与 clause_text 必填' });
        }
        const [inserted] = await db('standard_clauses')
            .insert({
                category,
                title: title || '',
                clause_text,
                industry: industry || '通用',
                owner_type: 'private',
                owner_user_id: userId,
                applicable_contract_types: JSON.stringify(applicable_contract_types || []),
                version: 1,
                metadata: JSON.stringify({}),
            })
            .returning(['id', 'category', 'title', 'clause_text', 'industry', 'owner_type', 'applicable_contract_types', 'version']);

        // 入库到向量库
        await importKnowledgeEntries([{
            source_type: 'standard_clause',
            source_id: `standard_clause:${inserted.id}`,
            title: inserted.title || inserted.category,
            category: inserted.category,
            content: inserted.clause_text,
            clauseId: String(inserted.id),
            source_name: '行业标准条款(私有)',
            metadata: {
                standard_id: inserted.id,
                industry: inserted.industry,
                owner_type: 'private',
                owner_user_id: userId,
            },
        }]);

        res.json({ item: { ...inserted, applicable_contract_types: parseJsonSafe(inserted.applicable_contract_types, []), canEdit: true } });
    } catch (error) {
        console.error('[Standards] POST / failed:', error);
        res.status(500).json({ error: `创建失败:${error.message}` });
    }
});

// 编辑:仅 owner 可编辑自己的 private 条款
router.put('/:id', async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    try {
        const id = Number(req.params.id);
        const existing = await db('standard_clauses').where({ id }).first();
        if (!existing) return res.status(404).json({ error: '条款不存在' });
        if (existing.owner_type !== 'private' || existing.owner_user_id !== userId) {
            return res.status(403).json({ error: '无权编辑该条款' });
        }
        const { category, title, clause_text, industry, applicable_contract_types } = req.body || {};
        const updates = {};
        if (category) updates.category = category;
        if (title !== undefined) updates.title = title;
        if (clause_text) updates.clause_text = clause_text;
        if (industry) updates.industry = industry;
        if (applicable_contract_types) updates.applicable_contract_types = JSON.stringify(applicable_contract_types);
        updates.version = (existing.version || 1) + 1;
        updates.updated_at = db.fn.now();

        await db('standard_clauses').where({ id }).update(updates);

        // 若 clause_text 变更,同步更新向量库:先删后插
        if (clause_text) {
            await deleteKnowledgeDocuments({ sourceType: 'standard_clause', sourceIds: [`standard_clause:${id}`] });
            await importKnowledgeEntries([{
                source_type: 'standard_clause',
                source_id: `standard_clause:${id}`,
                title: updates.title || existing.title || updates.category || existing.category,
                category: updates.category || existing.category,
                content: clause_text,
                clauseId: String(id),
                source_name: '行业标准条款(私有)',
                metadata: {
                    standard_id: id,
                    industry: updates.industry || existing.industry,
                    owner_type: 'private',
                    owner_user_id: userId,
                },
            }]);
        }

        const updated = await db('standard_clauses').where({ id }).first();
        res.json({ item: { ...updated, applicable_contract_types: parseJsonSafe(updated.applicable_contract_types, []), canEdit: true } });
    } catch (error) {
        console.error('[Standards] PUT /:id failed:', error);
        res.status(500).json({ error: `编辑失败:${error.message}` });
    }
});

// 删除:仅 owner 可删自己的 private 条款
router.delete('/:id', async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    try {
        const id = Number(req.params.id);
        const existing = await db('standard_clauses').where({ id }).first();
        if (!existing) return res.status(404).json({ error: '条款不存在' });
        if (existing.owner_type !== 'private' || existing.owner_user_id !== userId) {
            return res.status(403).json({ error: '无权删除该条款' });
        }
        await db('standard_clauses').where({ id }).delete();
        await deleteKnowledgeDocuments({ sourceType: 'standard_clause', sourceIds: [`standard_clause:${id}`] });
        res.json({ success: true });
    } catch (error) {
        console.error('[Standards] DELETE /:id failed:', error);
        res.status(500).json({ error: `删除失败:${error.message}` });
    }
});

// 对比:给定条款文本,返回 top-3 相似标准条款(公共库 + 当前用户私有库)
router.post('/compare', async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    try {
        const { text, contractType, limit } = req.body || {};
        if (!text || text.length < 5) {
            return res.status(400).json({ error: 'text 必填且至少 5 字' });
        }
        // 注:vectorStore 当前仅按 source_type 过滤,owner 过滤在结果层做
        const results = await searchVectorDocumentsMulti([text], {
            sourceTypes: ['standard_clause'],
            limit: Math.max(3, Math.min(10, Number(limit) || 5)),
            rerank: true,
            scoreThreshold: 0.3,
        });

        // 加载所有命中标准条款的元数据(用于过滤 owner 和补充字段)
        const matchedIds = results.map((r) => r.metadata?.standard_id).filter(Boolean);
        let standardsById = {};
        if (matchedIds.length) {
            const rows = await db('standard_clauses').whereIn('id', matchedIds);
            standardsById = Object.fromEntries(rows.map((r) => [r.id, r]));
        }

        const items = results
            .map((r) => {
                const sid = r.metadata?.standard_id;
                const std = sid ? standardsById[sid] : null;
                if (!std) return null;
                // 私有库仅 owner 可见
                if (std.owner_type === 'private' && std.owner_user_id !== userId) return null;
                return {
                    standard_id: std.id,
                    category: std.category,
                    title: std.title,
                    clause_text: std.clause_text,
                    industry: std.industry,
                    owner_type: std.owner_type,
                    applicable_contract_types: parseJsonSafe(std.applicable_contract_types, []),
                    score: r.rerank_score ?? r.score ?? 0,
                };
            })
            .filter(Boolean)
            .slice(0, Number(limit) || 5);

        res.json({ items });
    } catch (error) {
        console.error('[Standards] POST /compare failed:', error);
        res.status(500).json({ error: `对比失败:${error.message}` });
    }
});

const parseJsonSafe = (raw, fallback) => {
    if (raw == null) return fallback;
    if (typeof raw === 'object') return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
};

module.exports = router;
