/**
 * @file services/lawSync.js
 * @brief 法规同步服务，将法律 Markdown 同步到数据库与向量库并管理版本时效性
 *
 * 核心职责：
 * - 解析 Markdown 写入 law_versions 表（冲突按 title+version_label 合并）
 * - 条文入库向量库并回填时效性专属列（law_status/effective_date/superseded_by）
 * - 标记同法律更早版本为"已修订"
 * - 提供法律版本时间线查询
 *
 * 关键实现：
 * - 中文日期（2021年1月1日）转 ISO 日期
 * - 版本标识推断：优先"修正/修订"事件年份，回退施行年份
 * - 按 effective_date 判定新旧版本，批量更新旧版 law_status
 * - source_name 用 LIKE title% 兼容"民法典"与"民法典 - 合同编"两种格式
 *
 * 依赖关系：
 * - 上游：fs、database、legalMarkdownParser、vectorStore
 * - 下游：法规同步接口调用 syncLawFromMarkdown
 */

const fs = require('fs');
const db = require('../database');
const { parseLegalMarkdownFile } = require('./legalMarkdownParser');
const vectorStore = require('./vectorStore');

// 将中文日期字符串(如 "2021年1月1日")转换为 ISO 日期("2021-01-01"),
// 供 law_versions.effective_date / vector_documents.effective_date 等 date 列使用
const parseChineseDate = (value) => {
    if (!value) return null;
    const match = String(value).match(/(\d{4})年(\d{1,2})月(\d{1,2})/);
    if (!match) return null;
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

// 从 metadata.events 推断版本标识:优先取"修正/修订"事件年份(如 "2020修正"),
// 否则回退到施行日期年份(如 "2021版");均不可用时返回空串
const inferVersionLabel = (events, effectiveDate) => {
    const amendEvent = (events || []).find((item) => /修正|修订|修正案/.test(item.event || ''));
    if (amendEvent) {
        const yearMatch = String(amendEvent.date || '').match(/(\d{4})/);
        if (yearMatch) return `${yearMatch[1]}修正`;
        return amendEvent.event || '';
    }
    if (effectiveDate) {
        const match = String(effectiveDate).match(/(\d{4})/);
        if (match) return `${match[1]}版`;
    }
    return '';
};

// 同步一部法律的 Markdown 到 law_versions 与向量库:
// 1. 解析 Markdown 得到条文 entries
// 2. 写入 law_versions(状态默认"现行"),冲突时按 (title, version_label) 合并
// 3. 为每个 entry 注入时效性字段后调用 vectorStore.importKnowledgeEntries 入库
// 4. importKnowledgeEntries 不会写入 law_status/effective_date/superseded_by 专属列,
//    此处按 source_id 精确回填新入库条文,确保检索过滤与 markSuperseded 生效
// 5. 调用 markSuperseded 将同法律的更早版本标记为"已修订"
async function syncLawFromMarkdown(filePath, options = {}) {
    try {
        const entries = parseLegalMarkdownFile(filePath, options);
        if (!entries || entries.length === 0) {
            throw new Error(`No legal entries parsed from ${filePath}`);
        }

        const first = entries[0];
        const title = first.title || options.title || '';
        const metadataEffectiveDate = (first.metadata && first.metadata.effective_date) || '';
        const effectiveDate = parseChineseDate(metadataEffectiveDate);
        const versionLabel = options.versionLabel
            || inferVersionLabel(first.metadata && first.metadata.events, metadataEffectiveDate)
            || '';

        // 写入 law_versions 表
        const rawMarkdown = fs.readFileSync(filePath, 'utf8');
        const [lawVersion] = await db('law_versions')
            .insert({
                title,
                version_label: versionLabel,
                effective_date: effectiveDate,
                status: '现行',
                source_url: options.sourceUrl || '',
                raw_markdown: rawMarkdown,
            })
            .onConflict(['title', 'version_label'])
            .merge()
            .returning('id');
        const lawVersionId = typeof lawVersion === 'object' ? lawVersion.id : lawVersion;

        // 为每个 entry 注入时效性字段,metadata 一并镜像以便从 metadata JSON 也能查询
        const enriched = entries.map((entry) => ({
            ...entry,
            law_status: '现行',
            effective_date: effectiveDate,
            superseded_by: '',
            metadata: {
                ...(entry.metadata || {}),
                law_status: '现行',
                effective_date: effectiveDate,
                superseded_by: '',
                law_version_id: lawVersionId,
            },
        }));
        await vectorStore.importKnowledgeEntries(enriched);

        // 回填新入库条文的专属列(向量库内部未写入这些字段)
        const sourceIds = enriched.map((entry) => entry.source_id).filter(Boolean);
        if (sourceIds.length > 0) {
            await db('vector_documents')
                .where(function () {
                    for (const sourceId of sourceIds) {
                        this.orWhere('source_id', sourceId)
                            .orWhere('source_id', 'like', `${sourceId}:chunk:%`);
                    }
                })
                .update({
                    law_status: '现行',
                    effective_date: effectiveDate,
                    superseded_by: '',
                });
        }

        // 标记同法律的旧版本为已修订
        await markSuperseded(title, lawVersionId, effectiveDate);

        return {
            lawVersionId,
            title,
            version_label: versionLabel,
            effective_date: effectiveDate,
            clauseCount: entries.length,
        };
    } catch (error) {
        console.error(`[lawSync] syncLawFromMarkdown failed: ${error.message}`);
        throw error;
    }
}

// 标记旧版本为已修订:
// - law_versions:同 title、id 不同、effective_date 更早、状态为"现行"的版本 → status="已修订"、superseded_by=新版本 id
// - vector_documents:source_name 以 title 开头、effective_date 更早、law_status="现行"的条文 → law_status="已修订"、superseded_by=新版本 id
// 无施行日期时无法判定新旧关系,直接返回 0
async function markSuperseded(title, newVersionId, newEffectiveDate) {
    try {
        if (!newEffectiveDate) {
            return { supersededCount: 0, updatedVectorDocs: 0 };
        }

        const supersededCount = await db('law_versions')
            .where('title', title)
            .whereNot('id', newVersionId)
            .where('status', '现行')
            .where('effective_date', '<', newEffectiveDate)
            .update({
                status: '已修订',
                superseded_by: newVersionId,
            });

        // source_name 可能是 "民法典" 或 "民法典 - 合同编",用 LIKE title% 兼容两种格式
        const updatedVectorDocs = await db('vector_documents')
            .where('source_name', 'like', `${title}%`)
            .where('law_status', '现行')
            .where('effective_date', '<', newEffectiveDate)
            .update({
                law_status: '已修订',
                superseded_by: String(newVersionId),
            });

        return {
            supersededCount: Number(supersededCount) || 0,
            updatedVectorDocs: Number(updatedVectorDocs) || 0,
        };
    } catch (error) {
        console.error(`[lawSync] markSuperseded failed: ${error.message}`);
        throw error;
    }
}

// 查询某法律的所有版本时间线,按施行日期倒序返回
async function getLawVersionComparison(title) {
    try {
        const versions = await db('law_versions')
            .where('title', title)
            .orderBy('effective_date', 'desc')
            .select(
                'id',
                'title',
                'version_label',
                'effective_date',
                'status',
                'superseded_by',
                'source_url',
                'synced_at',
            );
        return versions;
    } catch (error) {
        console.error(`[lawSync] getLawVersionComparison failed: ${error.message}`);
        throw error;
    }
}

module.exports = {
    syncLawFromMarkdown,
    markSuperseded,
    getLawVersionComparison,
};
