const axios = require('axios');
const iconv = require('iconv-lite');

const DEFAULT_TIMEOUT = 8000;

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

const normalizeUrlHost = (url) => {
    try {
        return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
        return '';
    }
};

const isHttpUrl = (url) => /^https?:\/\//i.test(String(url || ''));

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

const stripTags = (value = '') => decodeHtml(String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '));

const absolutizeUrl = (url, baseUrl) => {
    try {
        return new URL(decodeHtml(url), baseUrl).toString();
    } catch {
        return '';
    }
};

const normalizeResult = (engine, item) => ({
    engine,
    title: stripTags(item.name || item.title || ''),
    url: item.url || item.link || '',
    snippet: stripTags(item.snippet || item.summary || item.description || ''),
});

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
    const encoding = charset || (contentType.includes('gb') ? 'gb18030' : 'utf8');
    return iconv.decode(Buffer.from(response.data), encoding);
};

const uniqueResults = (results) => {
    const seen = new Set();
    return results.filter((item) => {
        const key = item.url || `${item.title}:${item.snippet}`;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const parseBingResults = (html) => {
    const results = [];
    const blocks = html.match(/<li[^>]+class="[^"]*\bb_algo\b[^"]*"[\s\S]*?<\/li>/gi) || [];

    for (const block of blocks) {
        const anchor = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i);
        if (!anchor) continue;

        const snippet = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
            || block.match(/<div[^>]+class="[^"]*\b(b_caption|b_snippet)\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        results.push(normalizeResult('bing-html', {
            title: anchor[2],
            url: decodeHtml(anchor[1]),
            snippet: snippet?.[2] || snippet?.[1] || '',
        }));
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

const bingSearch = async (query, count) => {
    const html = await fetchSearchPage('https://cn.bing.com/search', {
        timeout: 3000,
        params: {
            q: query,
            count,
            mkt: 'zh-CN',
            setlang: 'zh-Hans',
        },
    });
    return parseBingResults(html).slice(0, count);
};

const baiduSearch = async (query, count) => {
    const html = await fetchSearchPage('https://www.baidu.com/s', {
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
};

const soSearch = async (query, count) => {
    const html = await fetchSearchPage('https://www.so.com/s', {
        params: { q: query },
        headers: {
            Referer: 'https://www.so.com/',
        },
    });
    return parseSoResults(html).slice(0, count);
};

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

    return Math.min(1, Number(score.toFixed(2)));
};

const verifySearchResults = (query, results) => uniqueResults(results)
    .filter((item) => item.title && isHttpUrl(item.url))
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
        bingSearch(query, count).catch((error) => {
            console.warn(`[WebSearch] Bing HTML failed: ${error.message}`);
            return [];
        }),
        baiduSearch(query, count).catch((error) => {
            console.warn(`[WebSearch] Baidu HTML failed: ${error.message}`);
            return [];
        }),
        soSearch(query, count).catch((error) => {
            console.warn(`[WebSearch] 360 HTML failed: ${error.message}`);
            return [];
        }),
    ];
    const [bingResults, baiduResults, soResults] = await Promise.all(jobs);
    const merged = [...bingResults, ...baiduResults, ...soResults];
    return verifySearchResults(query, merged).slice(0, count * 2);
};

const extractCompanyNames = (text) => {
    const companySuffix = '(?:\\u6709\\u9650\\u8d23\\u4efb\\u516c\\u53f8|\\u80a1\\u4efd\\u6709\\u9650\\u516c\\u53f8|\\u96c6\\u56e2\\u6709\\u9650\\u516c\\u53f8|\\u6709\\u9650\\u516c\\u53f8|\\u516c\\u53f8)';
    const matches = String(text || '').match(new RegExp(`[\\u4e00-\\u9fa5\uff08\uff09()]{2,40}${companySuffix}`, 'g')) || [];
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
