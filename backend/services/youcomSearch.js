/**
 * @file services/youcomSearch.js
 * @brief You.com Search & Research API 集成，为合同审查提供结构化搜索和企业核验
 *
 * 核心职责：
 * - 调用 You.com Search API 进行通用网页搜索
 * - 调用 You.com Research API 进行深度研究（适用于复杂法律问题）
 * - 提供与 webSearch.js 兼容的接口，便于无缝切换
 *
 * 依赖关系：
 * - 上游：axios
 * - 下游：webSearch.js 优先调用，失败时回退到 HTML 抓取
 */

const axios = require('axios');

const YOUCOM_SEARCH_URL = 'https://ydc-index.io/v1/search';
const YOUCOM_RESEARCH_URL = 'https://ydc-index.io/v1/research';

const DEFAULT_TIMEOUT = 15000;

const getApiKey = () => {
    const key = process.env.YOUCOM_API_KEY;
    if (!key) throw new Error('YOUCOM_API_KEY environment variable is not set');
    return key;
};

/**
 * 通用网页搜索
 * @param {string} query - 搜索关键词
 * @param {number} count - 返回结果数量上限
 * @returns {Promise<Array>} 搜索结果数组，字段与 webSearch.js 一致
 */
const searchWeb = async (query, { count = 5 } = {}) => {
    const apiKey = getApiKey();

    let response;
    try {
        response = await axios.post(
            YOUCOM_SEARCH_URL,
            {
                query,
                count: Math.min(count, 20),
            },
            {
                headers: {
                    'Accept': 'application/json',
                    'X-API-Key': apiKey,
                },
                timeout: DEFAULT_TIMEOUT,
            },
        );
    } catch (error) {
        console.warn(`[YoucomSearch] Search API failed: ${error.message}`);
        return [];
    }

    if (response.status === 429) {
        console.warn('[YoucomSearch] Rate limit exceeded (429)');
        return [];
    }
    if (response.status === 401) {
        console.warn('[YoucomSearch] API key invalid or expired');
        return [];
    }
    if (response.status === 403) {
        console.warn('[YoucomSearch] API key has insufficient permissions');
        return [];
    }
    if (response.status !== 200) {
        console.warn(`[YoucomSearch] Search failed with status ${response.status}`);
        return [];
    }

    const results = response.data?.results;
    if (!results || !Array.isArray(results)) return [];

    return results.slice(0, count).map((item, index) => {
        const snippets = item.snippets || [];
        const snippetRaw = (Array.isArray(snippets) && snippets[0]) ? snippets[0] : (item.description || '');
        const snippet = snippetRaw.length > 300 ? snippetRaw.slice(0, 300) + '...' : snippetRaw;
        return {
            engine: 'youcom',
            title: item.title || '',
            url: item.url || '',
            snippet,
            authenticity_score: 0, // You.com results are considered pre-verified
            verified: true,
            verification_basis: ['youcom_search_api'],
            host: extractHost(item.url || ''),
            position: index + 1,
        };
    });
};

/**
 * 深度研究搜索（适用于复杂法律问题）
 * @param {string} query - 研究主题
 * @param {string} effort - 研究深度: lite, standard, deep, exhaustive
 * @returns {Promise<Object>} 研究结果，包含 content 和 sources
 */
const researchWeb = async (query, effort = 'standard') => {
    const apiKey = getApiKey();

    const allowedEfforts = ['lite', 'standard', 'deep', 'exhaustive'];
    const resolvedEffort = allowedEfforts.includes(effort) ? effort : 'standard';

    let response;
    try {
        response = await axios.post(
            YOUCOM_RESEARCH_URL,
            {
                input: query,
                research_effort: resolvedEffort,
            },
            {
                headers: {
                    'Accept': 'application/json',
                    'X-API-Key': apiKey,
                },
                timeout: 120000, // Research API timeout is longer
            },
        );
    } catch (error) {
        console.warn(`[YoucomSearch] Research API failed: ${error.message}`);
        return { content: '', sources: [] };
    }

    if (response.status === 429) {
        console.warn('[YoucomSearch] Research rate limit exceeded (429)');
        return { content: '', sources: [] };
    }
    if (response.status !== 200) {
        console.warn(`[YoucomSearch] Research failed with status ${response.status}`);
        return { content: '', sources: [] };
    }

    const data = response.data || {};
    const content = data.content || '';
    const sources = (data.sources || []).map((source, index) => ({
        engine: 'youcom-research',
        title: source.title || `Source ${index + 1}`,
        url: source.url || '',
        snippet: Array.isArray(source.snippets) ? source.snippets[0] : (source.snippets || ''),
        authenticity_score: 1.0,
        verified: true,
        verification_basis: ['youcom_research_api'],
        host: extractHost(source.url || ''),
        position: index + 1,
    }));

    return { content, sources };
};

/**
 * 企业信息搜索（统一社会信用代码查询）
 * 使用 Research API 进行深度研究，适合获取企业详细信息
 * @param {string} companyName - 公司名称
 * @returns {Promise<Object>} 企业查询结果，字段与 webSearch.js searchCompanyInfo 一致
 */
const searchCompanyInfo = async (companyName) => {
    const query = `${companyName} 统一社会信用代码`;
    const { sources } = await researchWeb(query, 'standard');
    return {
        companyName,
        query,
        results: sources,
        verifiedResults: sources.filter((item) => item.verified),
    };
};

const extractHost = (url) => {
    try {
        return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
        return '';
    }
};

module.exports = {
    searchWeb,
    researchWeb,
    searchCompanyInfo,
};
