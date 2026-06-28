/**
 * @file services/vectorStore/seedSources.js
 * @brief 扫描法律 Markdown 与案例 JSON 文件，提供 seed 源适配
 *
 * 核心职责：
 * - 发现并枚举知识库 seed 文件（法律 Markdown、案例 JSON）
 * - 对无法被结构化解析器处理的文件提供纯文本 fallback entry
 *
 * 关键实现：
 * - listConfiguredLawDirs 支持环境变量覆盖默认 seed 目录
 * - listMarkdownFiles 递归遍历并排除索引/模板文件
 * - fallbackLawEntryFromFile 读取文件并生成 plain-markdown-fallback entry
 *
 * 依赖关系：
 * - 上游：path、fs、crypto、./config、./textChunking
 * - 下游：被 index.js seed 流程调用
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { lawsMarkdownDir, caseJsonDir, CASE_SEED_LIMIT, DEFAULT_LAW_SEED_DIRS } = require('./config');
const { plainMarkdownContent } = require('./textChunking');

// 文件发现与 seed 源适配器：扫描法律 Markdown / 案例 JSON 目录
// 返回原始文件路径列表，以及无法被结构化解析器处理时的纯文本 fallback entry

const listConfiguredLawDirs = () => {
    const configured = String(process.env.LAW_SEED_DIRS || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    const dirs = configured.length ? configured : DEFAULT_LAW_SEED_DIRS;
    return dirs.map((item) => path.isAbsolute(item) ? item : path.join(lawsMarkdownDir, item));
};

const listMarkdownFiles = (dirs) => {
    const rootDirs = Array.isArray(dirs) ? dirs : [dirs];
    const files = [];
    const walk = (currentDir) => {
        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
                continue;
            }
            if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
                files.push(fullPath);
            }
        }
    };
    for (const dir of rootDirs) {
        if (fs.existsSync(dir)) walk(dir);
    }
    return files
        .filter((filePath) => {
            const filename = path.basename(filePath).toLowerCase();
            return filename !== '_index.md' && filename !== '法律法规模版.md';
        })
        .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
};

const listCaseJsonFiles = () => {
    const dir = process.env.CASE_SEED_DIR
        ? (path.isAbsolute(process.env.CASE_SEED_DIR) ? process.env.CASE_SEED_DIR : path.join(__dirname, '..', '..', process.env.CASE_SEED_DIR))
        : caseJsonDir;
    if (!fs.existsSync(dir) || CASE_SEED_LIMIT <= 0) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
        .map((entry) => path.join(dir, entry.name))
        .sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'zh-Hans-CN'))
        .slice(0, CASE_SEED_LIMIT);
};

const fallbackLawEntryFromFile = (filePath) => {
    const markdown = fs.readFileSync(filePath, 'utf8');
    const cleaned = plainMarkdownContent(markdown);
    if (!cleaned) return null;
    const relativePath = path.relative(lawsMarkdownDir, filePath);
    const title = cleaned.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
        || path.basename(filePath, path.extname(filePath));
    return {
        source_type: 'law',
        source_id: `law-file:${crypto.createHash('sha256').update(`${relativePath}|${cleaned}`).digest('hex')}`,
        title,
        category: path.dirname(relativePath).replace(/[\\/]/g, ' / '),
        source_name: title,
        content: cleaned,
        metadata: {
            source_file: relativePath,
            parser: 'plain-markdown-fallback',
        },
    };
};

module.exports = {
    listConfiguredLawDirs,
    listMarkdownFiles,
    listCaseJsonFiles,
    fallbackLawEntryFromFile,
};
