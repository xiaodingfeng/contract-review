/**
 * @file services/caseJsonParser.js
 * @brief 裁判文书 JSON 解析器，将案例文档转换为知识库结构化条目
 *
 * 核心职责：
 * - 从案例 document 提取标题、案情、裁判理由、裁判结果
 * - 生成稳定 source_id 与分类（charge）信息
 * - 输出含 pid/charge/article 等字段的 metadata
 *
 * 关键实现：
 * - normalizeText 规范化空白字符
 * - stableId 基于 sourceFile+sourceKey+title 哈希生成
 * - charge 数组拼接为分类，article 数组映射为 clause_id
 * - 基本案情+裁判理由+裁判结果+全文拼接为 content
 *
 * 依赖关系：
 * - 上游：path、crypto
 * - 下游：案例同步入库调用 parseCaseJsonDocument
 */

const path = require('path');
const crypto = require('crypto');

const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const stableId = (parts) => crypto
    .createHash('sha256')
    .update(parts.map((part) => String(part || '')).join('|'))
    .digest('hex')
    .slice(0, 24);

const parseCaseTitle = (document, fallbackTitle) => {
    const title = normalizeText(document.qw).slice(0, 120);
    return title || fallbackTitle;
};

const buildCaseContent = (document) => {
    const sections = [
        ['基本案情', document.fact],
        ['裁判理由', document.reason],
        ['裁判结果', document.result],
        ['全文', document.qw],
    ];
    return sections
        .map(([label, value]) => {
            const text = normalizeText(value);
            return text ? `${label}: ${text}` : '';
        })
        .filter(Boolean)
        .join('\n\n');
};

const parseCaseJsonDocument = (document, { sourceFile = '' } = {}) => {
    const fallbackTitle = sourceFile
        ? path.basename(sourceFile, path.extname(sourceFile))
        : `case-${document.pid || stableId([document.qw, document.fact])}`;
    const title = parseCaseTitle(document, fallbackTitle);
    const charge = Array.isArray(document.charge) ? document.charge.map(normalizeText).filter(Boolean) : [];
    const articles = Array.isArray(document.article) ? document.article.filter((item) => item !== null && item !== undefined) : [];
    const category = charge.length ? charge.join(' / ') : '裁判文书';
    const content = buildCaseContent(document);
    if (!content) return null;

    const sourceKey = document.pid !== undefined && document.pid !== null
        ? `pid:${document.pid}`
        : stableId([title, content]);

    return {
        source_type: 'case',
        source_id: `case:${stableId([sourceFile, sourceKey, title])}`,
        title,
        category,
        clause_id: articles.length ? articles.map((item) => `第${item}条`).join(' / ') : '',
        source_name: sourceFile || title,
        content,
        metadata: {
            pid: document.pid ?? null,
            charge,
            article: articles,
            source_file: sourceFile,
            parser: 'case-json-template',
            fields: ['qw', 'fact', 'reason', 'result', 'charge', 'article'],
        },
    };
};

module.exports = {
    parseCaseJsonDocument,
};
