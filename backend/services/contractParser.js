// 合同条款树解析器
// 识别 章/编 → 条 → 款(X.X) 层级，输出可独立审查的叶子条款列表
// 叶子条款是长合同分层审查的最小单元：默认以"条"为单位，款(X.X)折叠进所属条；
// 若合同无条款结构，则按段落 fallback 切分。

// 第X章/编（一级容器，不作为叶子）
const CHAPTER_PATTERN = /^第([〇零一二两三四五六七八九十百千万亿\d]+)[章编]\s*(.*)$/;
// 第X条（二级，默认叶子单位）
const ARTICLE_PATTERN = /^第([〇零一二两三四五六七八九十百千万亿\d]+)条\s*(.*)$/;
// X.X 或 X.X.X（三级款）
const SUBSECTION_PATTERN = /^(\d+\.\d+(?:\.\d+)*)\s*(.*)$/;

// 中文数字 → 阿拉伯数字
const CHINESE_DIGIT = { '〇': 0, '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
const CHINESE_UNIT = { '十': 10, '百': 100, '千': 1000, '万': 10000 };

const chineseToNumber = (raw) => {
    if (/^\d+$/.test(raw)) return Number(raw);
    let total = 0;       // 已结算（万级以上）
    let section = 0;     // 当前段（万级以内累计）
    let current = 0;     // 待乘单位的数字
    for (const c of raw) {
        if (c in CHINESE_DIGIT) {
            current = CHINESE_DIGIT[c];
        } else if (c in CHINESE_UNIT) {
            const unit = CHINESE_UNIT[c];
            if (current === 0) current = 1; // "十" 单独出现 → 1*10
            section += current * unit;
            current = 0;
            if (unit === 10000) { total += section; section = 0; }
        } else {
            return NaN; // 含未知字符，转换失败
        }
    }
    return total + section + current;
};

// 把中文/阿拉伯数字规范化为 clause_id 用的字符串
const toArticleNumber = (raw) => {
    const num = chineseToNumber(raw);
    return Number.isNaN(num) ? raw : String(num);
};

// 无条款结构时的段落 fallback 切分：双换行优先，超长段落按句号补切，目标 200-500 字/段
const fallbackParagraphSplit = (text) => {
    const rawParas = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    const paragraphs = [];
    for (const para of rawParas) {
        if (para.length <= 500) {
            paragraphs.push(para);
            continue;
        }
        // 长段落按中文句末标点切分，再合并到 200-500 字
        const sentences = para.split(/(?<=[。！？；])/).map((s) => s.trim()).filter(Boolean);
        let buf = '';
        for (const s of sentences) {
            if (buf && (buf + s).length > 500) {
                paragraphs.push(buf);
                buf = s;
            } else {
                buf += s;
            }
        }
        if (buf) paragraphs.push(buf);
    }
    return paragraphs.map((p, i) => {
        const id = `段落${i + 1}`;
        return {
            clause_id: id,
            path: [id],
            title: id,
            text: p,
            char_count: p.length,
            children: [],
        };
    });
};

/**
 * 解析合同条款树，返回叶子条款列表。
 * @param {string} plainText 合同纯文本
 * @returns {Array<{clause_id:string,path:string[],title:string,text:string,char_count:number,children:[]}>}
 */
const parseContractTree = (plainText) => {
    const text = String(plainText || '');
    if (!text.trim()) return [];

    const lines = text.split(/\r?\n/);
    const clauses = []; // 叶子条款

    let chapterTitle = '';
    let preambleLines = [];
    let current = null; // { clause_id, path, title, lines }

    const flush = () => {
        if (!current) return;
        const body = current.lines.join('\n').trim();
        if (body) {
            clauses.push({
                clause_id: current.clause_id,
                path: current.path,
                title: current.title,
                text: body,
                char_count: body.length,
                children: [],
            });
        }
        current = null;
    };

    for (const rawLine of lines) {
        const line = String(rawLine).trim();
        if (!line) {
            // 空行作为段落分隔保留到当前条款
            if (current) current.lines.push('');
            continue;
        }

        const chapterMatch = line.match(CHAPTER_PATTERN);
        if (chapterMatch) {
            flush();
            const num = toArticleNumber(chapterMatch[1]);
            chapterTitle = `第${num}章 ${chapterMatch[2] || ''}`.trim();
            continue;
        }

        const articleMatch = line.match(ARTICLE_PATTERN);
        if (articleMatch) {
            flush();
            const num = toArticleNumber(articleMatch[1]);
            const clauseId = `第${num}条`;
            current = {
                clause_id: clauseId,
                path: [chapterTitle].filter(Boolean),
                title: `${clauseId} ${articleMatch[2] || ''}`.trim(),
                lines: [],
            };
            continue;
        }

        const subMatch = line.match(SUBSECTION_PATTERN);
        if (subMatch) {
            if (current && /^第.+条$/.test(current.clause_id)) {
                // 款隶属于当前条，折叠进条文本（保持条为审查单元）
                current.lines.push(line);
            } else {
                // 无上级条：款独立成叶
                flush();
                const clauseId = subMatch[1]; // 如 "3.1"
                current = {
                    clause_id: clauseId,
                    path: [chapterTitle].filter(Boolean),
                    title: `${clauseId} ${subMatch[2] || ''}`.trim(),
                    lines: [line],
                };
            }
            continue;
        }

        // 普通正文行
        if (current) {
            current.lines.push(line);
        } else {
            preambleLines.push(line);
        }
    }
    flush();

    // 完全没有条款结构 → 段落 fallback
    if (clauses.length === 0) {
        return fallbackParagraphSplit(text);
    }

    // 开头前言（条款之前的内容）作为独立条款保留
    const preamble = preambleLines.join('\n').trim();
    if (preamble.length > 20) {
        clauses.unshift({
            clause_id: '前言',
            path: [],
            title: '前言',
            text: preamble,
            char_count: preamble.length,
            children: [],
        });
    }
    return clauses;
};

/**
 * 估算文本 token 数：中文 1 字 ≈ 1.5 token，英文 4 字符 ≈ 1 token。
 * @param {string} text
 * @returns {number}
 */
const estimateTokenCount = (text) => {
    const s = String(text || '');
    let chinese = 0;
    let other = 0;
    for (const ch of s) {
        if (ch >= '\u4e00' && ch <= '\u9fff') chinese += 1;
        else other += 1;
    }
    return Math.ceil(chinese * 1.5 + other / 4);
};

module.exports = {
    parseContractTree,
    estimateTokenCount,
    chineseToNumber, // 导出便于测试
};
