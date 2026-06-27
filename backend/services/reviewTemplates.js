const path = require('path');
const fs = require('fs');
const db = require('../database');
const { embedText } = require('./embeddingClient');

const templatesPath = path.join(__dirname, '..', 'data', 'reviewTemplates.json');

// 从 JSON 文件加载模板(数据库不可用时的回退路径)
const loadTemplatesFromJson = () => {
    if (!fs.existsSync(templatesPath)) return [];
    return JSON.parse(fs.readFileSync(templatesPath, 'utf8'));
};

// 生成模板的典型描述(无 LLM 依赖),用于语义匹配
const generateTypicalDescription = (template) => {
    const name = template.name || template.id || '合同';
    const reviewPoints = (template.review_points || []).slice(0, 5).join('、');
    const corePurposes = (template.core_purposes || []).slice(0, 2).join('、');
    return `该模板用于审查${name}。审查要点:${reviewPoints}。核心目的:${corePurposes}`;
};

// 将数据库行转换为模板对象(jsonb 字段由 knex+pg 自动解析为对象)
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

// 获取全部模板:优先查数据库,失败回退 JSON 文件
const getAllTemplates = async () => {
    try {
        const rows = await db('review_templates').orderBy('created_at', 'asc');
        if (rows && rows.length > 0) {
            return rows.map(rowToTemplate);
        }
    } catch (error) {
        console.warn('[reviewTemplates] DB query failed, falling back to JSON:', error.message);
    }
    return loadTemplatesFromJson();
};

// 按 id 获取模板:优先查数据库,失败回退 JSON
const getTemplateById = async (id) => {
    if (!id) return null;
    try {
        const row = await db('review_templates').where({ id }).first();
        if (row) return rowToTemplate(row);
    } catch (error) {
        console.warn('[reviewTemplates] DB query failed, falling back to JSON:', error.message);
    }
    return loadTemplatesFromJson().find((template) => template.id === id) || null;
};

// 启动时调用:若 review_templates 表为空,从 JSON 导入,标记 is_system=true,生成 typical_description 与 embedding
const seedTemplatesIfEmpty = async () => {
    try {
        const countRow = await db('review_templates').count({ count: '*' }).first();
        const count = Number(countRow?.count || 0);
        if (count > 0) {
            console.log(`[reviewTemplates] Table already has ${count} templates, skipping seed.`);
            return { seeded: 0, total: count };
        }
        const templates = loadTemplatesFromJson();
        let seeded = 0;
        for (const template of templates) {
            const typicalDescription = generateTypicalDescription(template);
            // 为模板描述生成 embedding,存入 typical_description_embedding 字段;失败则为 null,matchTemplate 时相似度降级为 0
            let embedding = null;
            try {
                const vector = await embedText(typicalDescription);
                embedding = Array.isArray(vector) ? JSON.stringify(vector) : null;
            } catch (error) {
                console.warn(`[reviewTemplates] Embedding failed for ${template.id}: ${error.message}`);
            }
            await db('review_templates').insert({
                id: template.id,
                name: template.name,
                contract_type_keywords: JSON.stringify(template.contract_type_keywords || []),
                review_points: JSON.stringify(template.review_points || []),
                core_purposes: JSON.stringify(template.core_purposes || []),
                report_sections: JSON.stringify(template.report_sections || []),
                prompt_rules: JSON.stringify(template.prompt_rules || []),
                typical_description: typicalDescription,
                typical_description_embedding: embedding,
                is_active: true,
                is_system: true,
            });
            seeded += 1;
        }
        console.log(`[reviewTemplates] Seeded ${seeded} templates from JSON (is_system=true).`);
        return { seeded, total: seeded };
    } catch (error) {
        console.error('[reviewTemplates] seedTemplatesIfEmpty failed:', error.message);
        return { seeded: 0, total: 0, error: error.message };
    }
};

// 余弦相似度
const cosineSimilarity = (a, b) => {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i += 1) {
        const av = a[i] || 0;
        const bv = b[i] || 0;
        dot += av * bv;
        normA += av * av;
        normB += bv * bv;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const parseEmbedding = (value) => {
    if (!value) return null;
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
};

// 关键词命中得分(保留原逻辑)
const keywordScore = (template, haystack) => (template.contract_type_keywords || []).reduce(
    (sum, keyword) => (haystack.includes(String(keyword).toLowerCase()) ? sum + 1 : sum),
    0,
);

// 模板匹配:关键词命中数 + 语义相似度 × 5 加权
// 混合合同(两个模板得分均 > 0.7)返回数组,审查点取并集;否则返回单模板对象(向后兼容)
const matchTemplate = async (contractType = '', text = '') => {
    const templates = await getAllTemplates();
    const haystack = `${contractType}\n${text}`.toLowerCase();

    // 语义相似度:对合同文本生成 embedding,与每个模板的 typical_description_embedding 计算余弦相似度
    let textEmbedding = null;
    try {
        // 截断合同文本,避免超出 embedding 模型上下文限制
        textEmbedding = await embedText(`${contractType}\n${text}`.slice(0, 4000));
    } catch (error) {
        console.warn('[reviewTemplates] Contract text embedding failed, semantic matching disabled:', error.message);
    }

    const scored = templates.map((template) => {
        const kw = keywordScore(template, haystack);
        let semantic = 0;
        const templateEmbedding = parseEmbedding(template.typical_description_embedding);
        if (textEmbedding && templateEmbedding) {
            semantic = cosineSimilarity(textEmbedding, templateEmbedding);
        }
        const score = kw + semantic * 5;
        return { template, score };
    }).sort((a, b) => b.score - a.score);

    if (scored.length === 0) return null;

    // 混合合同:两个模板得分均 > 0.7,返回数组,审查点取并集
    if (scored.length >= 2 && scored[0].score > 0.7 && scored[1].score > 0.7) {
        const unionPoints = Array.from(new Set([
            ...(scored[0].template.review_points || []),
            ...(scored[1].template.review_points || []),
        ]));
        const unionPurposes = Array.from(new Set([
            ...(scored[0].template.core_purposes || []),
            ...(scored[1].template.core_purposes || []),
        ]));
        return [
            { template: { ...scored[0].template, review_points: unionPoints, core_purposes: unionPurposes }, score: scored[0].score },
            { template: { ...scored[1].template, review_points: unionPoints, core_purposes: unionPurposes }, score: scored[1].score },
        ];
    }

    // 单模板:向后兼容返回对象;得分全为 0 时回退到 general
    const best = scored[0];
    if (best.score <= 0) {
        return templates.find((t) => t.id === 'general') || templates[0] || null;
    }
    return best.template;
};

module.exports = {
    getAllTemplates,
    getTemplateById,
    matchTemplate,
    seedTemplatesIfEmpty,
    generateTypicalDescription,
};
