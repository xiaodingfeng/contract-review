/**
 * @file services/contractAnalysis/docxEdit.js
 * @brief 条款感知的 DOCX 文本定位、直接编辑与审阅修订
 */
const AdmZip = require('adm-zip');

const escapeXmlText = (text) => String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const escapeXmlAttr = (text) => escapeXmlText(text)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

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
    if (exactIndex >= 0) return { start: exactIndex, end: exactIndex + candidate.length };
    const normalizedFull = normalizeForDocxMatch(fullText);
    const normalizedCandidate = normalizeForDocxMatch(candidate).value;
    if (!normalizedCandidate) return null;
    const normalizedIndex = normalizedFull.value.indexOf(normalizedCandidate);
    if (normalizedIndex < 0) return null;
    return {
        start: normalizedFull.indexMap[normalizedIndex],
        end: normalizedFull.indexMap[normalizedIndex + normalizedCandidate.length - 1] + 1,
    };
};

const isHeadingParagraphAt = (xml, position) => {
    const paragraphStart = Math.max(xml.lastIndexOf('<w:p>', position), xml.lastIndexOf('<w:p ', position));
    if (paragraphStart < 0) return false;
    const paragraphEnd = xml.indexOf('</w:p>', position);
    if (paragraphEnd < 0) return false;
    return /<w:pStyle\b[^>]*w:val="(?:Heading\d*|Title|标题\d*)"/i
        .test(xml.slice(paragraphStart, paragraphEnd + 6));
};

const paragraphText = (paragraphXml) => {
    const withoutDeletedRevisions = String(paragraphXml || '').replace(/<w:del\b[\s\S]*?<\/w:del>/g, '');
    return (withoutDeletedRevisions.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g) || [])
        .map((node) => unescapeXmlText(node.replace(/^<w:t\b[^>]*>|<\/w:t>$/g, '')))
        .join('');
};

const parseClausePrefix = (text) => {
    const value = String(text || '').trim();
    const match = value.match(/^(\d+(?:\.\d+)+)\s*/);
    return match
        ? { clauseNo: match[1], body: value.slice(match[0].length).trim() }
        : { clauseNo: '', body: value };
};

const ensureClauseNumber = (replacement, clauseNo) => {
    if (!clauseNo) return String(replacement || '').trim();
    const replacementInfo = parseClausePrefix(replacement);
    if (replacementInfo.clauseNo) return String(replacement || '').trim();
    return `${clauseNo} ${String(replacement || '').trim()}`.trim();
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
            isHeading: isHeadingParagraphAt(xml, match.index),
        });
        fullText += decodedText;
    }
    const range = findDocxTextRange(fullText, candidate);
    if (!range) return { xml, replaced: false };
    const overlappingRuns = runs.filter((run) => run.end > range.start && run.start < range.end);
    const insertionRun = overlappingRuns.find((run) => !run.isHeading) || overlappingRuns[0];
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
        let nextText = run.start <= range.start ? before : '';
        if (run === insertionRun) nextText += safeSuggestion;
        if (run.end >= range.end) nextText += after;
        const attrs = /^\s/.test(nextText) || /\s$/.test(nextText)
            ? (run.attrs.includes('xml:space=') ? run.attrs : `${run.attrs} xml:space="preserve"`)
            : run.attrs;
        parts.push(`<w:t${attrs}>${escapeXmlText(nextText)}</w:t>`);
    }
    parts.push(xml.slice(cursor));
    return { xml: parts.join(''), replaced: true };
};

const makeRun = (text, runProperties = '', textTag = 'w:t') => {
    if (!text) return '';
    const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
    return `<w:r>${runProperties}<${textTag}${preserve}>${escapeXmlText(text)}</${textTag}></w:r>`;
};

const replaceTextWithRevision = (paragraphXml, range, replacement, options = {}) => {
    if (/<w:(?:hyperlink|fldChar|instrText|bookmarkStart|commentRangeStart|ins|del)\b/.test(paragraphXml)) {
        throw new Error('DOCX_COMPLEX_PARAGRAPH_UNSUPPORTED');
    }
    const text = paragraphText(paragraphXml);
    const oldText = text.slice(range.start, range.end);
    const startTag = paragraphXml.match(/^<w:p\b[^>]*>/)?.[0] || '<w:p>';
    const pPr = paragraphXml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] || '';
    const runProperties = paragraphXml.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/)?.[0] || '';
    const before = text.slice(0, range.start);
    const after = text.slice(range.end);
    const id = Number(options.revisionId || 1);
    const author = escapeXmlAttr(options.author || 'AI审查');
    const date = escapeXmlAttr(options.date || new Date().toISOString());
    const deleted = oldText
        ? `<w:del w:id="${id}" w:author="${author}" w:date="${date}">${makeRun(oldText, runProperties, 'w:delText')}</w:del>`
        : '';
    const inserted = replacement
        ? `<w:ins w:id="${id + 1}" w:author="${author}" w:date="${date}">${makeRun(replacement, runProperties)}</w:ins>`
        : '';
    return `${startTag}${pPr}${makeRun(before, runProperties)}${deleted}${inserted}${makeRun(after, runProperties)}</w:p>`;
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

const resolveParagraphMatch = (documentXml, originalText, suggestedText, originalCandidates = []) => {
    const paragraphs = [];
    const pattern = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
    let match;
    while ((match = pattern.exec(documentXml)) !== null) {
        paragraphs.push({ xml: match[0], start: match.index, end: match.index + match[0].length, text: paragraphText(match[0]) });
    }
    const candidates = normalizeReplacementCandidates(originalText, originalCandidates);
    const findMatches = (bodyOnly) => {
        const found = [];
        for (const candidate of candidates) {
            const source = parseClausePrefix(candidate);
            const needle = bodyOnly ? source.body : candidate;
            if (!needle || (bodyOnly && !source.clauseNo)) continue;
            for (let index = 0; index < paragraphs.length; index += 1) {
                const paragraph = paragraphs[index];
                const target = parseClausePrefix(paragraph.text);
                if (bodyOnly && target.clauseNo !== source.clauseNo) continue;
                const range = findDocxTextRange(paragraph.text, needle);
                if (!range) continue;
                let replacement = String(suggestedText || '').trim();
                const replacementInfo = parseClausePrefix(replacement);
                if (bodyOnly && replacementInfo.clauseNo === source.clauseNo) replacement = replacementInfo.body;
                if (!bodyOnly && source.clauseNo && !replacementInfo.clauseNo) {
                    replacement = ensureClauseNumber(replacement, source.clauseNo);
                }
                found.push({
                    paragraphIndex: index,
                    paragraph,
                    range,
                    matchedText: paragraph.text.slice(range.start, range.end),
                    replacement,
                    clauseNo: source.clauseNo || target.clauseNo,
                    strategy: bodyOnly ? 'clause-body' : 'exact-paragraph-text',
                });
            }
            if (found.length) break;
        }
        return found;
    };
    let matches = findMatches(false);
    if (!matches.length) matches = findMatches(true);
    if (!matches.length) throw new Error('DOCX_EXACT_TEXT_NOT_FOUND');
    if (matches.length > 1) throw new Error('DOCX_TEXT_MATCH_AMBIGUOUS');
    return matches[0];
};

const replaceTextInDocx = (filePath, originalText, suggestedText, originalCandidates = [], options = {}) => {
    const zip = new AdmZip(filePath);
    const entry = zip.getEntry('word/document.xml');
    if (!entry) throw new Error('DOCX_DOCUMENT_XML_NOT_FOUND');
    const documentXml = entry.getData().toString('utf8');
    const resolved = resolveParagraphMatch(documentXml, originalText, suggestedText, originalCandidates);
    let paragraphXml;
    if (options.mode === 'review') {
        const maxRevisionId = Math.max(0, ...(documentXml.match(/w:id="(\d+)"/g) || [])
            .map((value) => Number(value.match(/\d+/)?.[0] || 0)));
        paragraphXml = replaceTextWithRevision(resolved.paragraph.xml, resolved.range, resolved.replacement, {
            revisionId: maxRevisionId + 1,
            author: options.author,
        });
    } else {
        const result = replaceTextInXmlRuns(resolved.paragraph.xml, resolved.matchedText, resolved.replacement);
        if (!result.replaced) throw new Error('DOCX_EXACT_TEXT_NOT_FOUND');
        paragraphXml = result.xml;
    }
    const updatedXml = `${documentXml.slice(0, resolved.paragraph.start)}${paragraphXml}${documentXml.slice(resolved.paragraph.end)}`;
    zip.updateFile('word/document.xml', Buffer.from(updatedXml, 'utf8'));
    zip.writeZip(filePath);
    return {
        replacements: 1,
        clauseNo: resolved.clauseNo,
        matchedText: resolved.matchedText,
        replacementText: resolved.replacement,
        strategy: resolved.strategy,
        mode: options.mode === 'review' ? 'review' : 'edit',
    };
};

module.exports = {
    escapeXmlText,
    unescapeXmlText,
    normalizeForDocxMatch,
    findDocxTextRange,
    isHeadingParagraphAt,
    paragraphText,
    parseClausePrefix,
    ensureClauseNumber,
    replaceTextInXmlRuns,
    replaceTextWithRevision,
    normalizeReplacementCandidates,
    resolveParagraphMatch,
    replaceTextInDocx,
};
