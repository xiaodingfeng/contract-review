const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const { generateTypicalDescription } = require('../services/reviewTemplates');
const { embedText } = require('../services/embeddingClient');

const router = express.Router();

// JSON 文件路径,DB 不可用或表为空时回退使用
const templatesJsonPath = path.join(__dirname, '..', 'data', 'reviewTemplates.json');

const loadTemplatesFromJson = () => {
    if (!fs.existsSync(templatesJsonPath)) return [];
    return JSON.parse(fs.readFileSync(templatesJsonPath, 'utf8'));
};

// 从请求 body 构建数据库可写入的模板字段(jsonb 字段需 JSON.stringify)
const buildTemplatePayload = (body) => ({
    name: body.name,
    contract_type_keywords: JSON.stringify(body.contract_type_keywords || []),
    review_points: JSON.stringify(body.review_points || []),
    core_purposes: JSON.stringify(body.core_purposes || []),
    report_sections: JSON.stringify(body.report_sections || []),
    prompt_rules: JSON.stringify(body.prompt_rules || []),
    typical_description: body.typical_description || '',
});

// 为模板描述生成 embedding,失败返回 null(降级为关键词匹配)
const generateEmbeddingForDescription = async (description) => {
    if (!description) return null;
    try {
        const vector = await embedText(description);
        return Array.isArray(vector) ? JSON.stringify(vector) : null;
    } catch (error) {
        console.warn(`[templates] Embedding generation failed: ${error.message}`);
        return null;
    }
};

// 将数据库行转换为模板对象(供接口返回,与 service 层 rowToTemplate 一致)
const rowToTemplate = (row) => {
    if (!row) return null;
    return {
        id: row.id,
        name: row.name,
        contract_type_keywords: row.contract_type_keywords || [],
        review_points: row.review_points || [],
        core_purposes: row.core_purposes || [],
        report_sections: row.report_sections || [],
        prompt_rules: row.prompt_rules || [],
        typical_description: row.typical_description || '',
        is_active: row.is_active,
        is_system: row.is_system,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
};

// GET /api/templates:列表,支持 q(搜索 name)、is_active(过滤)、分页(page/page_size,默认 1/20)
// DB 查询失败或表为空时,回退到 JSON 文件(与 service 层 getAllTemplates 行为一致)
router.get('/', async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size) || 20));
        const q = String(req.query.q || '').trim();
        const isActive = req.query.is_active;

        let rows = [];
        let useFallback = false;
        try {
            const baseQuery = db('review_templates');
            if (q) baseQuery.where('name', 'like', `%${q}%`);
            if (isActive === 'true' || isActive === 'false') {
                baseQuery.where('is_active', isActive === 'true');
            }
            rows = await baseQuery.clone()
                .orderBy('created_at', 'asc')
                .limit(pageSize)
                .offset((page - 1) * pageSize);
            // 若 DB 查询返回空,尝试回退 JSON(可能是表未 seed)
            if (rows.length === 0) {
                const totalRow = await baseQuery.clone().count({ total: '*' }).first();
                if (Number(totalRow?.total || 0) === 0) useFallback = true;
            }
        } catch (dbError) {
            console.warn('[templates] DB query failed, falling back to JSON:', dbError.message);
            useFallback = true;
        }

        if (useFallback) {
            let jsonTemplates = loadTemplatesFromJson();
            if (q) jsonTemplates = jsonTemplates.filter((t) => (t.name || '').includes(q));
            if (isActive === 'true') jsonTemplates = jsonTemplates.filter((t) => t.is_active !== false);
            if (isActive === 'false') jsonTemplates = jsonTemplates.filter((t) => t.is_active === false);
            // JSON 回退时忽略分页(总数有限),返回全部
            return res.json({
                items: jsonTemplates.map((t) => ({
                    ...t,
                    is_active: t.is_active !== false,
                    is_system: true,
                })),
                total: jsonTemplates.length,
                page: 1,
                page_size: jsonTemplates.length,
                _fallback: 'json',
            });
        }

        // 正常 DB 路径:重新统计 total(已应用 q/is_active 过滤)
        const countQuery = db('review_templates');
        if (q) countQuery.where('name', 'like', `%${q}%`);
        if (isActive === 'true' || isActive === 'false') {
            countQuery.where('is_active', isActive === 'true');
        }
        const totalRow = await countQuery.clone().count({ total: '*' }).first();

        res.json({
            items: rows.map(rowToTemplate),
            total: Number(totalRow?.total || 0),
            page,
            page_size: pageSize,
        });
    } catch (error) {
        console.error('[templates] GET list failed:', error.message);
        // 最终兜底:返回 JSON 文件内容,避免前端完全无数据
        const jsonTemplates = loadTemplatesFromJson();
        res.json({
            items: jsonTemplates.map((t) => ({ ...t, is_active: t.is_active !== false, is_system: true })),
            total: jsonTemplates.length,
            page: 1,
            page_size: jsonTemplates.length,
            _fallback: 'json',
        });
    }
});

// POST /api/templates:新建模板,is_system=false,自动生成 embedding
router.post('/', async (req, res) => {
    try {
        const { id, name, typical_description } = req.body;
        if (!id || !name) {
            return res.status(400).json({ error: 'id 和 name 为必填项。' });
        }
        const existing = await db('review_templates').where({ id }).first();
        if (existing) {
            return res.status(409).json({ error: `模板 id "${id}" 已存在。` });
        }

        // typical_description 未提供时自动生成
        const description = typical_description || generateTypicalDescription(req.body);
        const embedding = await generateEmbeddingForDescription(description);

        const payload = buildTemplatePayload(req.body);
        payload.id = id;
        payload.typical_description = description;
        payload.typical_description_embedding = embedding;
        payload.is_active = req.body.is_active !== undefined ? !!req.body.is_active : true;
        payload.is_system = false; // 用户新建的模板均为非系统模板

        await db('review_templates').insert(payload);
        const row = await db('review_templates').where({ id }).first();
        res.status(201).json(rowToTemplate(row));
    } catch (error) {
        console.error('[templates] POST create failed:', error.message);
        res.status(500).json({ error: '模板创建失败。' });
    }
});

// PUT /api/templates/:id:编辑模板,编辑前先将当前状态写入 template_versions(version 自增),再 update
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const current = await db('review_templates').where({ id }).first();
        if (!current) {
            return res.status(404).json({ error: '模板不存在。' });
        }

        // 写入编辑前快照:version = 当前最大 version + 1
        const maxVersionRow = await db('template_versions')
            .where({ template_id: id })
            .max({ max: 'version' })
            .first();
        const nextVersion = Number(maxVersionRow?.max || 0) + 1;
        await db('template_versions').insert({
            template_id: id,
            version: nextVersion,
            snapshot: JSON.stringify(rowToTemplate(current)),
            changed_by: req.headers['x-user-id'] || null,
        });

        // 更新模板:typical_description 未提供时自动生成,并重新生成 embedding
        const description = req.body.typical_description || generateTypicalDescription({ ...current, ...req.body });
        const embedding = await generateEmbeddingForDescription(description);

        const payload = buildTemplatePayload(req.body);
        payload.typical_description = description;
        payload.typical_description_embedding = embedding;
        payload.updated_at = db.fn.now();
        if (req.body.is_active !== undefined) payload.is_active = !!req.body.is_active;

        await db('review_templates').where({ id }).update(payload);
        const row = await db('review_templates').where({ id }).first();
        res.json(rowToTemplate(row));
    } catch (error) {
        console.error('[templates] PUT update failed:', error.message);
        res.status(500).json({ error: '模板更新失败。' });
    }
});

// DELETE /api/templates/:id:系统模板返回 400,非系统模板硬删
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const current = await db('review_templates').where({ id }).first();
        if (!current) {
            return res.status(404).json({ error: '模板不存在。' });
        }
        if (current.is_system) {
            return res.status(400).json({ error: '系统模板不可删除' });
        }
        await db('template_versions').where({ template_id: id }).del();
        await db('review_templates').where({ id }).del();
        res.json({ deleted: true, id });
    } catch (error) {
        console.error('[templates] DELETE failed:', error.message);
        res.status(500).json({ error: '模板删除失败。' });
    }
});

// GET /api/templates/:id/versions:返回版本历史(按 version desc)
router.get('/:id/versions', async (req, res) => {
    try {
        const { id } = req.params;
        const rows = await db('template_versions')
            .where({ template_id: id })
            .orderBy('version', 'desc');
        res.json({
            items: rows.map((row) => ({
                id: row.id,
                template_id: row.template_id,
                version: row.version,
                snapshot: row.snapshot,
                changed_by: row.changed_by,
                created_at: row.created_at,
            })),
            total: rows.length,
        });
    } catch (error) {
        console.error('[templates] GET versions failed:', error.message);
        res.status(500).json({ error: '版本历史加载失败。' });
    }
});

// POST /api/templates/:id/revert/:version:回滚,先把当前状态写入新版本快照,再用目标版本 snapshot 覆盖 review_templates
router.post('/:id/revert/:version', async (req, res) => {
    try {
        const { id, version } = req.params;
        const versionNum = Number(version);
        const current = await db('review_templates').where({ id }).first();
        if (!current) {
            return res.status(404).json({ error: '模板不存在。' });
        }
        const target = await db('template_versions')
            .where({ template_id: id, version: versionNum })
            .first();
        if (!target) {
            return res.status(404).json({ error: `版本 ${versionNum} 不存在。` });
        }

        // 先把当前状态写入新版本快照(使回滚动作本身可被再次回滚)
        const maxVersionRow = await db('template_versions')
            .where({ template_id: id })
            .max({ max: 'version' })
            .first();
        const nextVersion = Number(maxVersionRow?.max || 0) + 1;
        await db('template_versions').insert({
            template_id: id,
            version: nextVersion,
            snapshot: JSON.stringify(rowToTemplate(current)),
            changed_by: req.headers['x-user-id'] || null,
        });

        // 用目标版本快照覆盖 review_templates
        const snapshot = typeof target.snapshot === 'string' ? JSON.parse(target.snapshot) : target.snapshot;
        const payload = {
            name: snapshot.name,
            contract_type_keywords: JSON.stringify(snapshot.contract_type_keywords || []),
            review_points: JSON.stringify(snapshot.review_points || []),
            core_purposes: JSON.stringify(snapshot.core_purposes || []),
            report_sections: JSON.stringify(snapshot.report_sections || []),
            prompt_rules: JSON.stringify(snapshot.prompt_rules || []),
            typical_description: snapshot.typical_description || '',
            typical_description_embedding: snapshot.typical_description_embedding || null,
            updated_at: db.fn.now(),
        };
        await db('review_templates').where({ id }).update(payload);
        const row = await db('review_templates').where({ id }).first();
        res.json(rowToTemplate(row));
    } catch (error) {
        console.error('[templates] POST revert failed:', error.message);
        res.status(500).json({ error: '模板回滚失败。' });
    }
});

module.exports = router;
