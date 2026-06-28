/**
 * @file services/vectorStore/textChunking.js
 * @brief 纯函数工具集：文本归一化、切分与哈希
 *
 * 核心职责：
 * - 提供文本归一化、Markdown 清洗、source 哈希、Milvus 表达式转义
 * - 实现三种切分策略：按句切分、按段落切分、按段落分组
 *
 * 关键实现：
 * - splitTextIntoChunks 按句末标点分段并控制重叠
 * - splitIntoParagraphs 保留段落边界，超长段落二次按句拆分
 * - splitIntoParagraphGroups 相邻 groupSize 段合并为块
 *
 * 依赖关系：
 * - 上游：crypto
 * - 下游：被 vectorStore 各模块及 knowledge 检索流程调用，无 DB/Milvus 依赖可独立单测
 */
const crypto = require('crypto');

// 纯函数工具集：文本归一化、Markdown 清洗、source 哈希、Milvus 表达式转义
// 以及三种文本切分策略（按句切分 / 按段落切分 / 按段落分组）
// 无 DB / Milvus 依赖，可独立单测

const normalizeText = (text) => String(text || '').replace(/\s+/g, ' ').trim();

const plainMarkdownContent = (markdown) => String(markdown || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();

const sourceHash = (parts) => crypto
    .createHash('sha256')
    .update(parts.map((part) => String(part || '')).join('|'))
    .digest('hex');

const escapeExpr = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const splitTextIntoChunks = (text, { maxChars = 900, overlap = 120 } = {}) => {
    const normalized = normalizeText(text);
    if (!normalized) return [];

    const paragraphs = normalized
        .split(/(?:\r?\n)+|(?<=[。！？；;.!?])\s*/g)
        .map((item) => item.trim())
        .filter(Boolean);
    const chunks = [];
    let current = '';

    const pushCurrent = () => {
        if (!current.trim()) return;
        chunks.push(current.trim());
        current = current.slice(Math.max(0, current.length - overlap));
    };

    for (const paragraph of paragraphs.length ? paragraphs : [normalized]) {
        if (paragraph.length > maxChars) {
            pushCurrent();
            for (let i = 0; i < paragraph.length; i += maxChars - overlap) {
                chunks.push(paragraph.slice(i, i + maxChars).trim());
            }
            current = '';
            continue;
        }
        if ((current + paragraph).length > maxChars) pushCurrent();
        current = current ? `${current}\n${paragraph}` : paragraph;
    }
    pushCurrent();

    return chunks.filter((chunk) => chunk.length >= 20);
};

// 按段落拆分文本（不跨段落合并），每个段落作为独立 query 保留完整语义
// 超长段落按句末标点二次拆分，同段落内的句子可组合到 maxChars 以内（语义连贯）
// minChars 以下的碎片直接丢弃，避免无意义 query 稀释检索
const splitIntoParagraphs = (text, { maxChars = 500, minChars = 5 } = {}) => {
    // 不能用 normalizeText：它会把 \r\n 折成空格，导致段落边界丢失、整篇被合并成一段
    // 只在段落内部折叠空格/制表符，保留 \r?\n 作为段落分隔
    const raw = String(text || '');
    if (!raw.trim()) return [];

    const paragraphs = raw
        .split(/(?:\r?\n)+/g)
        .map((p) => p.replace(/[ \t]+/g, ' ').trim())
        .filter(Boolean);

    const result = [];
    for (const para of paragraphs.length ? paragraphs : [raw.trim()]) {
        if (para.length <= maxChars) {
            result.push(para);
            continue;
        }
        // 超长段落按句末标点拆分，同段落内句子组合到 maxChars 以内
        const sentences = para.split(/(?<=[。！？；;.!?])\s*/g).map((s) => s.trim()).filter(Boolean);
        let buf = '';
        for (const sentence of sentences.length ? sentences : [para]) {
            if (sentence.length > maxChars) {
                if (buf) { result.push(buf); buf = ''; }
                result.push(sentence); // 超长单句保持原样，交给 embedding 模型截断
                continue;
            }
            if ((buf + sentence).length > maxChars) {
                if (buf) result.push(buf);
                buf = sentence;
            } else {
                buf = buf ? `${buf}${sentence}` : sentence;
            }
        }
        if (buf) result.push(buf);
    }
    return result.filter((p) => p.length >= minChars);
};

// 通道 B「合同内容」专用切分：每个 \n 一段，相邻 groupSize 段合并为一个 chunk
// 目的：把"每行一段"的细粒度按语义聚合成块，既保留合同自然结构，
// 又避免每行一个 query 产生大量噪声检索；maxChars 防止单块过长被 embedding 截断
const splitIntoParagraphGroups = (text, { groupSize = 5, maxChars = 500, minChars = 5 } = {}) => {
    const raw = String(text || '');
    if (!raw.trim()) return [];

    const paragraphs = raw
        .split(/(?:\r?\n)+/g)
        .map((p) => p.replace(/[ \t]+/g, ' ').trim())
        .filter(Boolean);
    if (paragraphs.length === 0) return [];

    const groups = [];
    let buf = [];
    let bufLen = 0;
    const flush = () => {
        if (buf.length === 0) return;
        const chunk = buf.join(' ');
        if (chunk.length >= minChars) groups.push(chunk);
        buf = [];
        bufLen = 0;
    };

    for (const para of paragraphs) {
        // 达到 groupSize 或加入后超过 maxChars，先 flush（保证块不致过长）
        if (buf.length >= groupSize || (bufLen + para.length + 1) > maxChars) {
            flush();
        }
        buf.push(para);
        bufLen += para.length + 1;
        // 单段本身超 maxChars，单独成块（不再与相邻段合并）
        if (para.length > maxChars) flush();
    }
    flush();
    return groups;
};

module.exports = {
    normalizeText,
    plainMarkdownContent,
    sourceHash,
    escapeExpr,
    splitTextIntoChunks,
    splitIntoParagraphs,
    splitIntoParagraphGroups,
};
