const axios = require('axios');
const iconv = require('iconv-lite');

const DEFAULT_TIMEOUT = 8000;
const MAX_RETRY = 1; // 失败后重试次数
const RETRY_DELAY_MS = 500;

const AUTHORITY_DOMAINS = [
    'gov.cn',
    'court.gov.cn',
    'chinacourt.org',
    'samr.gov.cn',
    'gsxt.gov.cn',
    'creditchina.gov.cn',
    'pbc.gov.cn',
    'npc.gov.cn',
    'moj.gov.cn',
];

// 广告/推广类标识（标题或 URL 中出现则过滤）
const SPAM_PATTERNS = [
    /推广/i, /广告/i, /sponsored/i, /赞助/i,
    /e\.baidu\.com/i, /pos\.baidu\.com/i, /cpro\.baidu\.com/i,
    /click\.qihoo\.com/i, /so\.com\/link\?/i,
];

const BROWSER_HEADERS = {
    'User-Agent': [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'AppleWebKit/537.36 (KHTML, like Gecko)',
        'Chrome/124.0.0.0 Safari/537.36',
    ].join(' '),
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeUrlHost = (url) => {
    try {
        return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
        return '';
    }
};

const isHttpUrl = (url) => /^https?:\/\//i.test(String(url || ''));

// 校验 URL 是否合法且可访问
const isValidUrl = (url) => {
    if (!isHttpUrl(url)) return false;
    try {
        const parsed = new URL(url);
        if (!parsed.hostname || !parsed.hostname.includes('.')) return false;
        // 过滤 javascript:、data: 等伪协议（isHttpUrl 已挡，双重保险）
        if (!['http:', 'https:'].includes(parsed.protocol)) return false;
        return true;
    } catch {
        return false;
    }
};

const decodeHtmlEntity = (entity) => {
    const named = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' ',
    };
    if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10));
    return named[entity] || `&${entity};`;
};

const decodeHtml = (value = '') => String(value)
    .replace(/&([a-zA-Z]+|#\d+|#x[\da-fA-F]+);/g, (_, entity) => decodeHtmlEntity(entity))
    .replace(/\s+/g, ' ')
    .trim();

// 增强的标签清理：移除 script/style/注释，再剥离所有标签
const stripTags = (value = '') => {
    let text = String(value);
    // 移除 HTML 注释
    text = text.replace(/<!--[\s\S]*?-->/g, ' ');
    // 移除 script/style/noscript 块
    text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
    // 将 <br>、</p>、</div> 等块级标签闭合转为空格，避免词粘连
    text = text.replace(/<\/(p|div|li|tr|h[1-6]|br|section|article|td|th)\s*>/gi, ' ');
    text = text.replace(/<br\s*\/?>/gi, ' ');
    // 剥离所有剩余标签
    text = text.replace(/<[^>]+>/g, ' ');
    return decodeHtml(text);
};

const absolutizeUrl = (url, baseUrl) => {
    try {
        return new URL(decodeHtml(url), baseUrl).toString();
    } catch {
        return '';
    }
};

// 判断结果是否为广告/推广
const isSpamResult = (result) => {
    const text = `${result.title} ${result.url} ${result.snippet}`;
    return SPAM_PATTERNS.some((pattern) => pattern.test(text));
};

// 校验单条结果质量
const isValidResult = (result) => {
    if (!result || typeof result !== 'object') return false;
    // 标题非空且长度合理
    const title = String(result.title || '').trim();
    if (title.length < 2) return false;
    if (title.length > 200) return false;
    // URL 必须合法
    if (!isValidUrl(result.url)) return false;
    // 摘要可为空但若存在不应过长
    const snippet = String(result.snippet || '').trim();
    if (snippet.length > 500) result.snippet = snippet.slice(0, 500);
    return true;
};

// 归一化结果格式，确保字段完整一致
const normalizeResult = (engine, item) => {
    const title = stripTags(item.name || item.title || '');
    const url = String(item.url || item.link || '').trim();
    const snippet = stripTags(item.snippet || item.summary || item.description || '');
    return {
        engine,
        title,
        url,
        snippet,
    };
};

const fetchSearchPage = async (url, options = {}) => {
    const response = await axios.get(url, {
        timeout: options.timeout || DEFAULT_TIMEOUT,
        responseType: 'arraybuffer',
        headers: {
            ...BROWSER_HEADERS,
            ...(options.headers || {}),
        },
        params: options.params,
        maxRedirects: options.maxRedirects ?? 5,
        validateStatus: (status) => status >= 200 && status < 400,
    });

    const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
    const charset = contentType.match(/charset=([^;\s]+)/)?.[1];
    let encoding = charset || (contentType.includes('gb') ? 'gb18030' : 'utf8');

    // 如果未从 content-type 检测到编码，尝试从 HTML meta 标签检测
    if (!charset) {
        const rawBuf = Buffer.from(response.data);
        const head = rawBuf.slice(0, 1024).toString('latin1');
        const metaCharset = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
        if (metaCharset) encoding = metaCharset.toLowerCase();
    }

    return iconv.decode(Buffer.from(response.data), encoding);
};

// 带重试的搜索执行
const withRetry = async (fn, label) => {
    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRY; attempt += 1) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt < MAX_RETRY) {
                await sleep(RETRY_DELAY_MS * (attempt + 1));
            }
        }
    }
    console.warn(`[WebSearch] ${label} failed after ${MAX_RETRY + 1} attempts: ${lastError?.message}`);
    return [];
};

// 基于 URL + 标题相似度的去重
const uniqueResults = (results) => {
    const seenUrls = new Set();
    const seenTitles = [];
    return results.filter((item) => {
        const urlKey = item.url || '';
        if (urlKey && seenUrls.has(urlKey)) return false;
        if (urlKey) seenUrls.add(urlKey);

        // 标题相似度去重：完全相同或一方为另一方前缀
        const title = String(item.title || '').trim().toLowerCase();
        if (title) {
            const isDup = seenTitles.some((existing) => {
                if (existing === title) return true;
                if (existing.length > 10 && title.length > 10) {
                    // 较长标题的包含关系视为重复
                    return existing.includes(title) || title.includes(existing);
                }
                return false;
            });
            if (isDup) return false;
            seenTitles.push(title);
        }
        return true;
    });
};

const parseBingResults = (html) => {
    const results = [];
    // 主匹配：b_algo 列表项
    const blocks = html.match(/<li[^>]+class="[^"]*\bb_algo\b[^"]*"[\s\S]*?<\/li>/gi) || [];

    for (const block of blocks) {
        const anchor = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i);
        if (!anchor) continue;

        const snippet = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
            || block.match(/<div[^>]+class="[^"]*\b(b_caption|b_snippet|b_factrow)\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        results.push(normalizeResult('bing-html', {
            title: anchor[2],
            url: decodeHtml(anchor[1]),
            snippet: snippet?.[2] || snippet?.[1] || '',
        }));
    }

    // 回退匹配：如果主匹配无结果，尝试更宽松的 h2 > a 结构
    if (results.length === 0) {
        const looseAnchors = html.match(/<h2[^>]*>\s*<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi) || [];
        for (const loose of looseAnchors) {
            const m = loose.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
            if (m) {
                results.push(normalizeResult('bing-html', {
                    title: m[2],
                    url: decodeHtml(m[1]),
                    snippet: '',
                }));
            }
        }
    }

    return results;
};

const parseBaiduResults = (html) => {
    const results = [];
    const blocks = html.match(/<div\s+class="[^"]*\bresult(?:-op)?\b[^"]*\bc-container\b[^"]*"[\s\S]*?(?=<div\s+class="[^"]*\bresult(?:-op)?\b[^"]*\bc-container\b|<\/body>)/gi) || [];

    for (const block of blocks) {
        const anchor = block.match(/<h3[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/i)
            || block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        if (!anchor) continue;

        const mu = block.match(/\bmu="([^"]+)"/i)?.[1];
        const snippet = block.match(/<span[^>]+class="[^"]*\bcontent-right_\d+[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
            || block.match(/<div[^>]+class="[^"]*\bc-abstract\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
            || block.match(/<div[^>]+class="[^"]*\bcontent\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
            || block.match(/"generalLines":\[\{"data":\[\{"text":"([^"]+)"/i);
        results.push(normalizeResult('baidu-html', {
            title: anchor[2],
            url: mu ? decodeHtml(mu) : absolutizeUrl(anchor[1], 'https://www.baidu.com/'),
            snippet: snippet?.[1] || '',
        }));
    }

    // 回退匹配：提取所有 mu 属性 + 相邻标题
    if (results.length === 0) {
        const muBlocks = html.match(/\bmu="(https?:\/\/[^"]+)"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi) || [];
        for (const muBlock of muBlocks) {
            const m = muBlock.match(/\bmu="(https?:\/\/[^"]+)"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
            if (m) {
                results.push(normalizeResult('baidu-html', {
                    title: m[2],
                    url: decodeHtml(m[1]),
                    snippet: '',
                }));
            }
        }
    }

    return results;
};

const parseSoResults = (html) => {
    const results = [];
    const blocks = html.match(/<li\s+class="[^"]*\bres-list\b[^"]*"[\s\S]*?(?=<li\s+class="[^"]*\bres-list\b|<\/ul>)/gi) || [];

    for (const block of blocks) {
        const anchor = block.match(/<h3[^>]+class="[^"]*\bres-title\b[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/i)
            || block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        if (!anchor) continue;

        const mdUrl = anchor[0].match(/\bdata-mdurl="([^"]+)"/i)?.[1]
            || block.match(/\bdata-mdurl="([^"]+)"/i)?.[1];
        const snippet = block.match(/<p[^>]+class="[^"]*\bres-list-summary\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
            || block.match(/<p[^>]+class="[^"]*\bres-desc\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i);

        results.push(normalizeResult('so-html', {
            title: anchor[2],
            url: mdUrl ? decodeHtml(mdUrl) : absolutizeUrl(anchor[1], 'https://www.so.com/'),
            snippet: snippet?.[1] || '',
        }));
    }

    // 回退匹配：data-mdurl 属性
    if (results.length === 0) {
        const mdBlocks = html.match(/data-mdurl="(https?:\/\/[^"]+)"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi) || [];
        for (const mdBlock of mdBlocks) {
            const m = mdBlock.match(/data-mdurl="(https?:\/\/[^"]+)"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
            if (m) {
                results.push(normalizeResult('so-html', {
                    title: m[2],
                    url: decodeHtml(m[1]),
                    snippet: '',
                }));
            }
        }
    }

    return results;
};

const resolveBaiduRedirect = async (result) => {
    const host = normalizeUrlHost(result.url);
    if (!host.endsWith('baidu.com')) return result;

    try {
        const response = await axios.get(result.url, {
            timeout: 3000,
            headers: BROWSER_HEADERS,
            maxRedirects: 0,
            validateStatus: (status) => status >= 300 && status < 400,
        });
        const location = response.headers?.location;
        return location ? { ...result, url: absolutizeUrl(location, result.url) } : result;
    } catch (error) {
        const location = error.response?.headers?.location;
        return location ? { ...result, url: absolutizeUrl(location, result.url) } : result;
    }
};

const bingSearch = async (query, count) => withRetry(async () => {
    const html = await fetchSearchPage('https://cn.bing.com/search', {
        timeout: 6000,
        params: {
            q: query,
            count,
            mkt: 'zh-CN',
            setlang: 'zh-Hans',
        },
    });
    return parseBingResults(html).slice(0, count);
}, 'Bing HTML');

const baiduSearch = async (query, count) => withRetry(async () => {
    const html = await fetchSearchPage('https://www.baidu.com/s', {
        timeout: 8000,
        maxRedirects: 3,
        params: {
            wd: query,
            rn: count,
            ie: 'utf-8',
        },
        headers: {
            Referer: 'https://www.baidu.com/',
        },
    });
    const results = parseBaiduResults(html).slice(0, count);
    return Promise.all(results.map(resolveBaiduRedirect));
}, 'Baidu HTML');

const soSearch = async (query, count) => withRetry(async () => {
    const html = await fetchSearchPage('https://www.so.com/s', {
        timeout: 7000,
        maxRedirects: 3,
        params: { q: query },
        headers: {
            Referer: 'https://www.so.com/',
        },
    });
    return parseSoResults(html).slice(0, count);
}, '360 HTML');

const scoreResult = (result, allResults, query) => {
    const host = normalizeUrlHost(result.url);
    const sameHostEngines = new Set(allResults
        .filter((item) => normalizeUrlHost(item.url) === host)
        .map((item) => item.engine));
    const text = `${result.title} ${result.snippet}`.toLowerCase();
    const queryTokens = String(query || '').toLowerCase().split(/\s+/).filter((item) => item.length >= 2);
    const tokenHits = queryTokens.filter((token) => text.includes(token)).length;

    let score = 0.2;
    if (result.url.startsWith('https://')) score += 0.1;
    if (AUTHORITY_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) score += 0.35;
    if (sameHostEngines.size > 1) score += 0.2;
    if (tokenHits > 0) score += Math.min(0.15, tokenHits * 0.05);
    // 有摘要的加分（无摘要的结果质量通常较低）
    if (result.snippet && result.snippet.length >= 10) score += 0.05;

    return Math.min(1, Number(score.toFixed(2)));
};

const verifySearchResults = (query, results) => uniqueResults(results)
    .filter((item) => isValidResult(item) && !isSpamResult(item))
    .map((item) => {
        const authenticity_score = scoreResult(item, results, query);
        return {
            ...item,
            host: normalizeUrlHost(item.url),
            authenticity_score,
            verified: authenticity_score >= 0.55,
            verification_basis: [
                item.url.startsWith('https://') ? 'HTTPS' : '',
                AUTHORITY_DOMAINS.some((domain) => normalizeUrlHost(item.url).endsWith(domain)) ? '官方或权威域名' : '',
                results.some((other) => other.engine !== item.engine && normalizeUrlHost(other.url) === normalizeUrlHost(item.url)) ? '多搜索源一致' : '',
            ].filter(Boolean),
        };
    })
    .sort((a, b) => b.authenticity_score - a.authenticity_score);

const searchWeb = async (query, { count = 5 } = {}) => {
    const jobs = [
        bingSearch(query, count),
        baiduSearch(query, count),
        soSearch(query, count),
    ];
    const [bingResults, baiduResults, soResults] = await Promise.all(jobs);
    const merged = [...bingResults, ...baiduResults, ...soResults];
    return verifySearchResults(query, merged).slice(0, count * 2);
};

const extractCompanyNames = (text) => {
    const companySuffix = '(?:\\u6709\\u9650\\u8d23\\u4efb\\u516c\\u53f8|\\u80a1\\u4efd\\u6709\\u9650\\u516c\\u53f8|\\u96c6\\u56e2\\u6709\\u9650\\u516c\\u53f8|\\u6709\\u9650\\u516c\\u53f8|\\u516c\\u53f8)';
    const matches = String(text || '').match(new RegExp(`[\\u4e00-\\u9fa5\\uff08\\uff09()]{2,40}${companySuffix}`, 'g')) || [];
    return Array.from(new Set(matches.map((item) => item.replace(/[\uff0c\u3002\uff1b\uff1a\u3001\s]+$/g, '')))).slice(0, 5);
};

const searchCompanyInfo = async (companyName) => {
    const query = `${companyName} 国家企业信用信息公示系统 工商 登记 法定代表人`;
    const results = await searchWeb(query, { count: 5 });
    return {
        companyName,
        query,
        results,
        verifiedResults: results.filter((item) => item.verified),
    };
};

module.exports = {
    searchWeb,
    searchCompanyInfo,
    extractCompanyNames,
    verifySearchResults,
};
