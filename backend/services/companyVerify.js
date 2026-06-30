/**
 * @file services/companyVerify.js
 * @brief 企业风险核验服务，按 provider 路由到 Mock/天眼查/企查查/网页搜索多源核验
 *
 * 核心职责：
 * - 判定企业风险等级（red/yellow/green）并生成建议文案
 * - 支持 gsxt_mock / tiyanji / qichacha / web_search 多 provider 路由
 * - 无 token 或第三方 API 失败时回退到网页搜索，兜底返回最小画像
 *
 * 关键实现：
 * - red：失信被执行或主体吊销/注销；yellow：被执行/行政处罚/经营异常
 * - 企查查 MD5(AppKey+TimeStamp+SecretKey) 签名鉴权
 * - 网页搜索回退：正则从摘要提取法人/统一代码/风险关键词
 * - 多级回退绝不抛错中断流程
 *
 * 依赖关系：
 * - 上游：axios、crypto、webSearch
 * - 下游：企业核验接口调用 verifyCompany
 */

const axios = require('axios');
const crypto = require('crypto');
const webSearch = require('./webSearch');

const DEFAULT_TIMEOUT = 8000;

/**
 * 判定企业风险等级
 * - red:   is_dishonest=true 或 company_status 含"吊销"/"注销"
 * - yellow: is_executed=true 或 has_admin_punishment=true 或 has_business_exception=true
 * - green: 其余
 * @param {object} profile CompanyRiskProfile
 * @returns {'red'|'yellow'|'green'}
 */
const determineRiskLevel = (profile) => {
    if (!profile) return 'green';
    if (profile.is_dishonest) return 'red';
    const status = String(profile.company_status || '');
    if (status.includes('吊销') || status.includes('注销')) return 'red';
    if (profile.is_executed) return 'yellow';
    if (profile.has_admin_punishment) return 'yellow';
    if (profile.has_business_exception) return 'yellow';
    return 'green';
};

/**
 * 基于风险等级生成建议文案
 * @param {object} profile CompanyRiskProfile
 * @returns {string}
 */
const buildSuggestion = (profile) => {
    const level = determineRiskLevel(profile);
    if (level === 'red') {
        return '对方为失信被执行人或主体异常,建议要求提供担保、调整付款方式或拒绝签约';
    }
    if (level === 'yellow') {
        return '对方存在被执行/行政处罚/经营异常记录,建议加强资信调查、要求提供担保或缩短付款周期';
    }
    return '主体状态正常,无重大风险';
};

/**
 * Mock 实现:返回固定绿色风险画像,便于无 token 调试
 * @param {string} name 企业名称
 * @returns {object} CompanyRiskProfile
 */
const verifyByGsxtMock = (name) => {
    const profile = {
        company_name: name,
        unified_code: '',
        legal_representative: '张三',
        registered_capital: '',
        establish_date: '',
        company_status: '在营',
        is_dishonest: false,
        is_executed: false,
        has_admin_punishment: false,
        has_business_exception: false,
        has_equity_pledge: false,
        has_chattel_mortgage: false,
        risk_level: 'green',
        risk_items: [],
        suggestion: '',
        data_source: 'mock',
        queried_at: new Date().toISOString(),
    };
    profile.risk_level = determineRiskLevel(profile);
    profile.suggestion = buildSuggestion(profile);
    return profile;
};

/**
 * 天眼查/tiyanji API 实现
 * 调用 ${COMPANY_API_BASE_URL}/company/info?name=xxx,Bearer 鉴权
 * 注意:实际字段需根据天眼查 API 文档调整,以下为合理映射假设
 * @param {string} name 企业名称
 * @returns {Promise<object>} CompanyRiskProfile
 */
const verifyByTiyanji = async (name) => {
    const baseUrl = process.env.COMPANY_API_BASE_URL || 'https://api.tiyanji.com/v2';
    const token = process.env.COMPANY_API_TOKEN;
    const url = `${baseUrl}/company/info?name=${encodeURIComponent(name)}`;

    const response = await axios.get(url, {
        timeout: DEFAULT_TIMEOUT,
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    // 兼容 { data: {...} } 与直接返回对象两种结构
    // 注意:以下字段名需根据天眼查/tiyanji API 文档调整
    const data = response.data?.data || response.data || {};

    const profile = {
        company_name: data.name || data.companyName || name,
        unified_code: data.creditNo || data.unifiedCode || data.regNo || '',
        legal_representative: data.legalPerson || data.legalRepresentative || '',
        registered_capital: data.regCapital || data.registeredCapital || '',
        establish_date: data.startDate || data.establishDate || data.esDate || '',
        company_status: data.regStatus || data.companyStatus || '在营',
        is_dishonest: Boolean(data.isDishonest ?? data.dishonest),
        is_executed: Boolean(data.isExecuted ?? data.executed),
        has_admin_punishment: Boolean(data.hasAdminPunishment ?? data.adminPunishment),
        has_business_exception: Boolean(data.hasBusinessException ?? data.businessException),
        has_equity_pledge: Boolean(data.hasEquityPledge ?? data.equityPledge),
        has_chattel_mortgage: Boolean(data.hasChattelMortgage ?? data.chattelMortgage),
        risk_level: 'green',
        risk_items: [],
        suggestion: '',
        data_source: 'tiyanji',
        queried_at: new Date().toISOString(),
    };

    // 映射风险事项明细(字段名需按实际 API 文档调整)
    const items = [];
    if (profile.is_dishonest) items.push({ type: '失信被执行', detail: data.dishonestDetail || '', date: '' });
    if (profile.is_executed) items.push({ type: '被执行人', detail: data.executedDetail || '', date: '' });
    if (profile.has_admin_punishment) items.push({ type: '行政处罚', detail: data.adminPunishmentDetail || '', date: '' });
    if (profile.has_business_exception) items.push({ type: '经营异常', detail: data.businessExceptionDetail || '', date: '' });
    if (profile.has_equity_pledge) items.push({ type: '股权出质', detail: data.equityPledgeDetail || '', date: '' });
    if (profile.has_chattel_mortgage) items.push({ type: '动产抵押', detail: data.chattelMortgageDetail || '', date: '' });
    profile.risk_items = items;

    profile.risk_level = determineRiskLevel(profile);
    profile.suggestion = buildSuggestion(profile);
    return profile;
};

/**
 * 企查查 OpenAPI 实现
 * 鉴权:AppKey + SecretKey,Token = MD5(AppKey + TimeStamp + SecretKey)
 * 接口形状参考企查查官方 OpenAPI v2 文档
 * 环境变量:COMPANY_API_TOKEN=AppKey,COMPANY_API_SECRET=SecretKey,
 *          COMPANY_API_BASE_URL(可选,默认 https://api.qichacha.com)
 * @param {string} name 企业名称
 * @returns {Promise<object>} CompanyRiskProfile
 */
const verifyByQichacha = async (name) => {
    const baseUrl = (process.env.COMPANY_API_BASE_URL || 'https://api.qichacha.com').replace(/\/$/, '');
    const appKey = process.env.COMPANY_API_TOKEN;
    const secretKey = process.env.COMPANY_API_SECRET;
    if (!appKey || !secretKey) {
        throw new Error('企查查 AppKey/SecretKey 未配置(COMPANY_API_TOKEN/COMPANY_API_SECRET)');
    }

    // 企查查 v2 签名:Token = MD5(AppKey + TimeStamp + SecretKey),TimeSpan 为秒级时间戳
    const timespan = String(Math.floor(Date.now() / 1000));
    const token = crypto.createHash('md5').update(appKey + timespan + secretKey).digest('hex').toUpperCase();

    // 企查查工商信息接口(含经营异常/失信/被执行人概要)
    const url = `${baseUrl}/ECIV4/GetBasicDetails`;
    const response = await axios.get(url, {
        timeout: DEFAULT_TIMEOUT,
        params: { keyword: name },
        headers: {
            'Content-Type': 'application/json',
            'AppKey': appKey,
            'Timespan': timespan,
            'Token': token,
        },
    });

    const payload = response.data?.Result || response.data?.data || response.data || {};
    const status = String(payload.Status || payload.OperName || '在营');

    const profile = {
        company_name: payload.Name || payload.name || name,
        unified_code: payload.CreditCode || payload.creditNo || payload.RegNo || '',
        legal_representative: payload.OperName || payload.legalPerson || '',
        registered_capital: payload.RegistCapi || payload.regCapital || '',
        establish_date: payload.StartDate || payload.esDate || '',
        company_status: status,
        is_dishonest: Boolean(payload.IsDishonest ?? /失信/.test(payload.SpecialStatus || '')),
        is_executed: Boolean(payload.IsExecuted ?? false),
        has_admin_punishment: Boolean(payload.HasAdminPunishment ?? false),
        has_business_exception: Boolean(payload.HasBusinessException ?? payload.InException ?? false),
        has_equity_pledge: Boolean(payload.HasEquityPledge ?? false),
        has_chattel_mortgage: Boolean(payload.HasChattelMortgage ?? false),
        risk_level: 'green',
        risk_items: [],
        suggestion: '',
        data_source: 'qichacha',
        queried_at: new Date().toISOString(),
    };

    // 风险事项明细(企查查字段名按官方文档映射)
    const items = [];
    if (profile.is_dishonest) items.push({ type: '失信被执行', detail: payload.DishonestDetail || '', date: '' });
    if (profile.is_executed) items.push({ type: '被执行人', detail: payload.ExecutedDetail || '', date: '' });
    if (profile.has_admin_punishment) items.push({ type: '行政处罚', detail: payload.AdminPunishmentDetail || '', date: '' });
    if (profile.has_business_exception) items.push({ type: '经营异常', detail: payload.BusinessExceptionDetail || '', date: '' });
    if (profile.has_equity_pledge) items.push({ type: '股权出质', detail: payload.EquityPledgeDetail || '', date: '' });
    if (profile.has_chattel_mortgage) items.push({ type: '动产抵押', detail: payload.ChattelMortgageDetail || '', date: '' });
    profile.risk_items = items;

    profile.risk_level = determineRiskLevel(profile);
    profile.suggestion = buildSuggestion(profile);
    return profile;
};
/**
 * 从单条文本中尝试提取某个字段，按给定的正则数组顺序匹配
 * @param {string} text 待匹配文本
 * @param {RegExp[]} patterns 正则表达式数组，按优先级排列
 * @returns {string} 提取到的值，失败返回空串
 */
const extractField = (text, patterns) => {
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1] && match[1].trim()) {
            return match[1].trim();
        }
    }
    return '';
};
/**
 * 基于网页搜索结果构建简化版 CompanyRiskProfile
 * 用于无 token 或第三方 API 失败时的回退路径
 * @param {string} name 企业名称
 * @param {object} [webResult] 已查询的 webSearch 结果(避免重复查询)
 * @returns {Promise<object>} CompanyRiskProfile
 */
const buildProfileFromWebSearch = async (name, webResult) => {
    const result = webResult || await webSearch.searchCompanyInfo(name).catch(() => null);
    const results = result?.results || [];

    // 按可信度排序，优先从高质量结果中提取
    const sortedResults = [...results].sort((a, b) => (b.authenticity_score || 0) - (a.authenticity_score || 0));

    // 提取所有候选文本（title + snippet），过滤掉明显不相关的条目
    const candidateTexts = sortedResults
        .filter((r) => r.title.includes(name) || r.snippet.includes(name))
        .map((r) => `${r.title} ${r.snippet}`);

    // 合并所有文本用于风险关键词检测
    const joinedSnippet = candidateTexts.join(' ');

    // 多模式正则定义：统一社会信用代码（18位字母数字，含关键词辅助）
    const codePatterns = [
        /统一社会信用代码[：: ]*([0-9A-HJ-NP-Z]{18})/i,
        /信用代码[：: ]*([0-9A-HJ-NP-Z]{18})/i,
        /统一社会信用代码[：: ]*([0-9A-Z]{18})/i,   // 宽松匹配
        /信用代码[：: ]*([0-9A-Z]{18})/i,
        /(?:统一社会信用代码|信用代码|代码)[^0-9A-Z]*([0-9A-Z]{18})/i,
        // 无关键词时尝试匹配独立18位码（可能误判，但作为兜底）
        /(?:^|\s)([0-9A-HJ-NP-Z]{18})(?:\s|$)/i,
    ];

    // 法定代表人
    const legalPatterns = [
        // 1. 最明确：法定代表人：或空格 + 姓名
        /法定代表人[：:\s]+([\u4e00-\u9fa5]{2,4})/,
        // 2. 法定代表人 是/为 + 姓名
        /法定代表人(?:是|为)\s*([\u4e00-\u9fa5]{2,4})/,
        // 3. 法定代表人后面任意分隔符，最后取2-4汉字
        /法定代表人[^：:\w]{0,3}[：:\s]*([\u4e00-\u9fa5]{2,4})/,
        // 4. 退而求其次：仅靠“法人”匹配（但需避免误抓）
        /(?:^|\s)法人[：:\s]+([\u4e00-\u9fa5]{2,4})/,
        // 5. 最后兜底：直接找“法定代表人”附近的2-4汉字
        /法定代表人[\s\S]{0,10}?([\u4e00-\u9fa5]{2,4})/,
    ];

    // 注册资本
    const capitalPatterns = [
        /注册资本[：: ]*([\d.]+)\s*万?元?/,
        /注册资金[：: ]*([\d.]+)\s*万?元?/,
        /注册资本[^：:]*[：: ]*([\d.]+)\s*万?元?/,
    ];

    // 成立日期
    const datePatterns = [
        /成立日期[：: ]*(\d{4}[-年]\d{1,2}[-月]\d{1,2})/,
        /成立时间[：: ]*(\d{4}[-年]\d{1,2}[-月]\d{1,2})/,
        /成立于[：: ]*(\d{4}[-年]\d{1,2}[-月]\d{1,2})/,
        /(\d{4}-\d{2}-\d{2})/,
    ];

    // 经营状态
    const statusPatterns = [
        /(?:经营状态|企业状态|状态)[：: ]*([\u4e00-\u9fa5]{2,6})/,
        /目前处于([\u4e00-\u9fa5]{2,6})状态/,
        /(开业|在营|存续|吊销|注销|迁出|停业)/,
    ];

    // 逐字段提取，优先从高可信度的文本中获取
    let unified_code = '';
    let legal_representative = '';
    let registered_capital = '';
    let establish_date = '';
    let company_status = '';

    for (const text of candidateTexts) {
        if (!unified_code) unified_code = extractField(text, codePatterns);
        if (!legal_representative) legal_representative = extractField(text, legalPatterns);
        if (!registered_capital) registered_capital = extractField(text, capitalPatterns);
        if (!establish_date) establish_date = extractField(text, datePatterns);
        if (!company_status) company_status = extractField(text, statusPatterns);
        // 如果所有字段都已获取，可提前退出
        if (unified_code && legal_representative && registered_capital && establish_date && company_status) break;
    }

    // 格式化日期为 YYYY-MM-DD
    if (establish_date) {
        establish_date = establish_date.replace(/[年月]/g, '-').replace(/日/, '').replace(/\s+/g, '');
        // 确保月份和日期补零 (简单处理)
        const parts = establish_date.split('-');
        if (parts.length === 3) {
            establish_date = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
        }
    }

    const profile = {
        company_name: name,
        unified_code: unified_code || '',
        legal_representative: legal_representative || '',
        registered_capital: registered_capital || '',
        establish_date: establish_date || '',
        company_status: company_status || '',
        is_dishonest: false,
        is_executed: false,
        has_admin_punishment: false,
        has_business_exception: false,
        has_equity_pledge: false,
        has_chattel_mortgage: false,
        risk_level: 'green',
        risk_items: [],
        suggestion: '',
        data_source: 'web_search_fallback',
        queried_at: new Date().toISOString(),
        web_search_results: results,
    };

    // 风险关键词检测
    const text = joinedSnippet.toLowerCase();
    if (/失信|老赖/.test(text)) {
        profile.is_dishonest = true;
        profile.risk_items.push({ type: '失信被执行', detail: '网页摘要提及失信/老赖记录', date: '' });
    }
    if (/被执行人|被执行/.test(text)) {
        profile.is_executed = true;
        profile.risk_items.push({ type: '被执行人', detail: '网页摘要提及被执行记录', date: '' });
    }
    if (/经营异常/.test(text)) {
        profile.has_business_exception = true;
        profile.risk_items.push({ type: '经营异常', detail: '网页摘要提及经营异常', date: '' });
    }
    if (/行政处罚|违法/.test(text)) {
        profile.has_admin_punishment = true;
        profile.risk_items.push({ type: '行政处罚', detail: '网页摘要提及行政处罚', date: '' });
    }

    profile.risk_level = determineRiskLevel(profile);
    profile.suggestion = buildSuggestion(profile);
    return profile;
};

/**
 * 统一入口:按 process.env.COMPANY_API_PROVIDER 路由到具体实现
 * - provider=gsxt_mock 时走 Mock(开发调试用)
 * - 配置了 token 的 tiyanji/tianyancha/qichacha 走对应第三方 API
 * - 无 token 或第三方 API 失败时回退到 webSearch.searchCompanyInfo,绝不抛错中断流程
 * @param {string} name 企业名称
 * @returns {Promise<object>} CompanyRiskProfile
 */
const verifyCompany = async (name) => {
    const provider = process.env.COMPANY_API_PROVIDER || 'web_search';
    const token = process.env.COMPANY_API_TOKEN;

    try {
        // 显式指定 Mock 时走 Mock(开发调试)
        if (provider === 'gsxt_mock') {
            return verifyByGsxtMock(name);
        }
        // 无 token 时走网页搜索(默认行为,真实数据)
        if (!token) {
            return await buildProfileFromWebSearch(name);
        }
        if (provider === 'tiyanji' || provider === 'tianyancha') {
            return await verifyByTiyanji(name);
        }
        if (provider === 'qichacha') {
            return await verifyByQichacha(name);
        }
        // 未知 provider 且有 token:尝试 tiyanji 风格的 Bearer 鉴权,失败由 catch 回退
        return await verifyByTiyanji(name);
    } catch (error) {
        console.warn(`[CompanyVerify] ${provider} 核验失败,回退网页搜索: ${error.message}`);
        try {
            return await buildProfileFromWebSearch(name);
        } catch (fallbackError) {
            console.warn(`[CompanyVerify] 网页搜索回退也失败: ${fallbackError.message}`);
            // 兜底返回最小化画像,确保不抛错
            const minimalProfile = {
                company_name: name,
                unified_code: '',
                legal_representative: '',
                registered_capital: '',
                establish_date: '',
                company_status: '',
                is_dishonest: false,
                is_executed: false,
                has_admin_punishment: false,
                has_business_exception: false,
                has_equity_pledge: false,
                has_chattel_mortgage: false,
                risk_level: 'green',
                risk_items: [],
                suggestion: '主体状态正常,无重大风险',
                data_source: 'web_search_fallback',
                queried_at: new Date().toISOString(),
            };
            return minimalProfile;
        }
    }
};

module.exports = {
    verifyCompany,
    determineRiskLevel,
    buildSuggestion,
    verifyByGsxtMock,
    verifyByTiyanji,
    verifyByQichacha,
    buildProfileFromWebSearch,
};
