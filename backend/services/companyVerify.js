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
 * 基于网页搜索结果构建简化版 CompanyRiskProfile
 * 用于无 token 或第三方 API 失败时的回退路径
 * @param {string} name 企业名称
 * @param {object} [webResult] 已查询的 webSearch 结果(避免重复查询)
 * @returns {Promise<object>} CompanyRiskProfile
 */
const buildProfileFromWebSearch = async (name, webResult) => {
    const result = webResult || await webSearch.searchCompanyInfo(name).catch(() => null);
    const results = result?.results || [];
    // 从网页摘要中尝试提取关键信息(法定代表人/统一社会信用代码)
    const joinedSnippet = results.map((r) => `${r.title} ${r.snippet}`).join(' ');
    const legalMatch = joinedSnippet.match(/(?:法定代表人|法人)[^\u4e00-\u9fa5]*([\u4e00-\u9fa5]{2,4})/);
    const codeMatch = joinedSnippet.match(/(?:统一社会信用代码|信用代码)[^\dA-Z]*([0-9A-Z]{15,18})/);
    const statusMatch = joinedSnippet.match(/(?:状态|经营状态)[^\u4e00-\u9fa5]*([\u4e00-\u9fa5]{2,6})/);

    const profile = {
        company_name: name,
        unified_code: codeMatch?.[1] || '',
        legal_representative: legalMatch?.[1] || '',
        registered_capital: '',
        establish_date: '',
        company_status: statusMatch?.[1] || '',
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
    // 从摘要中识别风险关键词
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
