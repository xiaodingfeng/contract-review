/**
 * @file services/contractAnalysis/docxEdit.js
 * @brief 在 DOCX 文件中精确定位并替换合同条款文本
 *
 * 核心职责：
 * - 对 DOCX 内 word/*.xml 进行文本替换，支持原文修改建议落地
 * - 处理 XML 实体转义与还原，保证内容写入安全
 * - 跨 w:t run 节点进行模糊匹配，应对文本被分散切割的情况
 *
 * 关键实现：
 * - normalizeForDocxMatch 将全角标点统一并去空白，建立索引映射
 * - replaceTextInXmlRuns 跨 run 拼接后定位目标区间并替换
 * - replaceTextInDocx 通过 AdmZip 直接读写 zip 内 XML 条目
 *
 * 依赖关系：
 * - 上游：fs、path、adm-zip
 * - 下游：被报告渲染、版本快照等需要回写 DOCX 的流程调用
 */
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const escapeXmlText = (text) => String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const unescapeXmlText = (text) => String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const normalizeForDocxMatch = (text) => {
    const normalized = [];
    const indexMap = [];
    for (let index = 0; index < String(text || '').length; index += 1) {
        const char = String(text)[index]
            .replace(/[“”]/g, '"')
            .replace(/[‘’]/g, "'")
            .replace(/[：]/g, ':')
            .replace(/[，]/g, ',')
            .replace(/[。]/g, '.');
        if (/\s/.test(char)) continue;
        normalized.push(char);
        indexMap.push(index);
    }
    return { value: normalized.join(''), indexMap };
};

const findDocxTextRange = (fullText, candidate) => {
    const exactIndex = fullText.indexOf(candidate);
    if (exactIndex >= 0) {
        return { start: exactIndex, end: exactIndex + candidate.length };
    }

    const normalizedFull = normalizeForDocxMatch(fullText);
    const normalizedCandidate = normalizeForDocxMatch(candidate).value;
    if (!normalizedCandidate) return null;

    const normalizedIndex = normalizedFull.value.indexOf(normalizedCandidate);
    if (normalizedIndex < 0) return null;

    const start = normalizedFull.indexMap[normalizedIndex];
    const end = normalizedFull.indexMap[normalizedIndex + normalizedCandidate.length - 1] + 1;
    return { start, end };
};

const replaceTextInXmlRuns = (xml, candidate, suggestedText) => {
    const textRunPattern = /<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g;
    const runs = [];
    let match;
    let fullText = '';

    while ((match = textRunPattern.exec(xml)) !== null) {
        const decodedText = unescapeXmlText(match[2]);
        runs.push({
            matchStart: match.index,
            matchEnd: match.index + match[0].length,
            attrs: match[1],
            rawText: match[2],
            text: decodedText,
            start: fullText.length,
            end: fullText.length + decodedText.length,
        });
        fullText += decodedText;
    }

    const range = findDocxTextRange(fullText, candidate);
    if (!range) return { xml, replaced: false };

    let inserted = false;
    const safeSuggestion = String(suggestedText || '').replace(/\r?\n+/g, ' ');
    const parts = [];
    let cursor = 0;

    for (const run of runs) {
        parts.push(xml.slice(cursor, run.matchStart));
        cursor = run.matchEnd;

        if (run.end <= range.start || run.start >= range.end) {
            parts.push(`<w:t${run.attrs}>${run.rawText}</w:t>`);
            continue;
        }

        const overlapStart = Math.max(range.start, run.start) - run.start;
        const overlapEnd = Math.min(range.end, run.end) - run.start;
        const before = run.text.slice(0, overlapStart);
        const after = run.text.slice(overlapEnd);
        let nextText = '';

        if (!inserted) {
            nextText = before + safeSuggestion;
            inserted = true;
        }
        if (run.end >= range.end) {
            nextText += after;
        }

        const attrs = /^\s/.test(nextText) || /\s$/.test(nextText)
            ? (run.attrs.includes('xml:space=') ? run.attrs : `${run.attrs} xml:space="preserve"`)
            : run.attrs;
        parts.push(`<w:t${attrs}>${escapeXmlText(nextText)}</w:t>`);
    }

    parts.push(xml.slice(cursor));
    return { xml: parts.join(''), replaced: true };
};

const normalizeReplacementCandidates = (originalText, originalCandidates = []) => {
    const candidates = [originalText, ...originalCandidates]
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    const seen = new Set();
    return candidates.filter((candidate) => {
        const key = normalizeForDocxMatch(candidate).value;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const replaceTextInDocx = (filePath, originalText, suggestedText, originalCandidates = []) => {
    const zip = new AdmZip(filePath);
    const xmlEntries = zip.getEntries().filter((entry) => /^word\/.*\.xml$/.test(entry.entryName));
    const escapedSuggestion = escapeXmlText(suggestedText);
    const candidates = normalizeReplacementCandidates(originalText, originalCandidates);
    let replacements = 0;

    for (const entry of xmlEntries) {
        let xml = entry.getData().toString('utf8');
        let updated = false;

        for (const candidate of candidates) {
            const escapedOriginal = escapeXmlText(candidate);
            const exactCount = xml.split(escapedOriginal).length - 1;
            if (exactCount > 0) {
                xml = xml.split(escapedOriginal).join(escapedSuggestion);
                replacements += exactCount;
                updated = true;
                break;
            }

            const runReplacement = replaceTextInXmlRuns(xml, candidate, suggestedText);
            if (runReplacement.replaced) {
                xml = runReplacement.xml;
                replacements += 1;
                updated = true;
                break;
            }
        }

        if (updated) {
            zip.updateFile(entry.entryName, Buffer.from(xml, 'utf8'));
        }
    }

    if (replacements === 0) {
        throw new Error('DOCX_EXACT_TEXT_NOT_FOUND');
    }

    zip.writeZip(filePath);
    return replacements;
};

module.exports = {
    escapeXmlText,
    unescapeXmlText,
    normalizeForDocxMatch,
    findDocxTextRange,
    replaceTextInXmlRuns,
    normalizeReplacementCandidates,
    replaceTextInDocx,
};
