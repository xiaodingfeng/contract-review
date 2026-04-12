const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INFO_END_MARK = '<!-- INFO END -->';
const ARTICLE_PATTERN = /^第([〇零一二两三四五六七八九十百千万亿\d]+)条\s*(.*)$/;

const normalizeLine = (line) => String(line || '').replace(/\uFEFF/g, '').trim();

const stripComment = (line) => normalizeLine(line).replace(/\s*<!--[\s\S]*?-->\s*/g, '').trim();

const stableId = (parts) => crypto
    .createHash('sha256')
    .update(parts.map((part) => String(part || '')).join('|'))
    .digest('hex')
    .slice(0, 24);

const cleanTitle = (value, fallback) => stripComment(value || '').replace(/^#+\s*/, '').trim() || fallback;

const parseInfoBlock = (lines, fallbackTitle = '未命名法律法规') => {
    const headings = [];
    const events = [];

    for (const line of lines) {
        const clean = stripComment(line);
        if (!clean) continue;

        const headingMatch = clean.match(/^#\s+(.+)$/);
        if (headingMatch) {
            headings.push(cleanTitle(headingMatch[1], fallbackTitle));
            continue;
        }

        const eventMatch = clean.match(/^(\d{4}年\d{1,2}月\d{1,2}日?)\s+(.+)$/);
        if (eventMatch) {
            events.push({ date: eventMatch[1], event: eventMatch[2].trim() });
        }
    }

    return {
        title: headings[0] || fallbackTitle,
        subtitle: headings[1] || '',
        events,
        effectiveDate: events.find((item) => /施行|生效|实施/.test(item.event))?.date || '',
    };
};

const pushArticle = (entries, article, context) => {
    if (!article) return;
    const body = article.lines.map(stripComment).filter(Boolean).join('\n');
    if (!body) return;

    const hierarchy = article.hierarchy.filter(Boolean);
    const clauseId = `第${article.articleNo}条`;
    const content = [
        hierarchy.length ? `层级：${hierarchy.join(' > ')}` : '',
        `${clauseId} ${body}`,
    ].filter(Boolean).join('\n');

    entries.push({
        source_type: 'law',
        source_id: `law:${stableId([context.title, context.subtitle, hierarchy.join('>'), clauseId, body])}`,
        title: context.title,
        category: context.subtitle || hierarchy[0] || '法律法规',
        clause_id: clauseId,
        source_name: [context.title, context.subtitle].filter(Boolean).join(' - '),
        source_url: context.sourceUrl || '',
        content,
        metadata: {
            title: context.title,
            subtitle: context.subtitle,
            hierarchy,
            clause_id: clauseId,
            events: context.events,
            effective_date: context.effectiveDate,
            source_file: context.sourceFile || '',
            parser: 'legal-markdown-template',
        },
    });
};

const parseLegalMarkdown = (markdown, options = {}) => {
    const lines = String(markdown || '').split(/\r?\n/);
    const fallbackTitle = options.title || options.sourceFile
        ? path.basename(options.title || options.sourceFile, path.extname(options.title || options.sourceFile))
        : '未命名法律法规';
    const infoEndIndex = lines.findIndex((line) => line.includes(INFO_END_MARK));
    const infoLines = infoEndIndex >= 0 ? lines.slice(0, infoEndIndex) : lines.slice(0, 12);
    const bodyLines = infoEndIndex >= 0 ? lines.slice(infoEndIndex + 1) : lines;
    const info = parseInfoBlock(infoLines, fallbackTitle);
    const context = {
        ...info,
        sourceFile: options.sourceFile || '',
        sourceUrl: options.sourceUrl || '',
    };

    const entries = [];
    const headings = [];
    let currentArticle = null;

    for (const rawLine of bodyLines) {
        const clean = stripComment(rawLine);
        if (!clean) continue;

        const headingMatch = clean.match(/^(#{2,6})\s+(.+)$/);
        if (headingMatch) {
            pushArticle(entries, currentArticle, context);
            currentArticle = null;
            const depth = headingMatch[1].length - 2;
            headings[depth] = cleanTitle(headingMatch[2], '');
            headings.length = depth + 1;
            continue;
        }

        const articleMatch = clean.match(ARTICLE_PATTERN);
        if (articleMatch) {
            pushArticle(entries, currentArticle, context);
            currentArticle = {
                articleNo: articleMatch[1],
                hierarchy: headings.slice(),
                lines: [articleMatch[2]],
            };
            continue;
        }

        if (currentArticle) {
            currentArticle.lines.push(clean);
        }
    }

    pushArticle(entries, currentArticle, context);
    return entries;
};

const parseLegalMarkdownFile = (filePath, options = {}) => parseLegalMarkdown(
    fs.readFileSync(filePath, 'utf8'),
    {
        ...options,
        sourceFile: options.sourceFile || path.basename(filePath),
    },
);

module.exports = {
    parseLegalMarkdown,
    parseLegalMarkdownFile,
};
