/**
 * @file services/contractAnalysis/backgroundAnalysis.js
 * @brief 后台异步执行完整合同审查流程的总调度
 *
 * 核心职责：
 * - 不阻塞 HTTP 响应，按七步流程串行执行审查
 * - 长合同（>8000 字）切换为条款树分层审查，逐条独立召回与 LLM 审查
 * - 聚合各步骤结果并落库，通过 Socket.IO 推送完成事件
 *
 * 关键实现：
 * - runAnalysisInBackground 串联 提取→检索→主体→规则→LLM→印章→保存
 * - 长合同以并发 3 调度条款审查，超长条款记入截断清单
 * - 硬性违规与 LLM 风险点去重，避免重复提示
 *
 * 依赖关系：
 * - 上游：../../database、../reviewTemplates、../webSearch、../companyVerify、../ruleEngine、../contractParser 及本目录各子模块
 * - 下游：被合同分析 API 路由作为异步任务启动
 */
const db = require('../../database');
const { getTemplateById, matchTemplate } = require('../reviewTemplates');
const { extractCompanyNames, searchCompanyInfo } = require('../webSearch');
const { verifyCompany } = require('../companyVerify');
const ruleEngine = require('../ruleEngine');
const contractParser = require('../contractParser');
const { isKnowledgeBaseOnlyMode } = require('../reviewPolicy');

const { findOwnedContract } = require('./auth');
const { emitAnalysisProgress, updateAnalysisJob, getIoInstance, TOTAL_EST_SECONDS } = require('./analysisJob');
const { extractTextFromFile, wrapContractContent } = require('./fileExtraction');
const { getRelevantKnowledge, annotateKnowledgeUpdates } = require('./knowledge');
const { callJsonLLM } = require('./llm');
const { normalizeAnalysisResult, aggregateClauseResults, buildStandardComparison } = require('./analysisCore');
const { analyzeSealAndSignature } = require('./seal');

// 后台异步执行合同审查（不阻塞 HTTP 响应）
const runAnalysisInBackground = async (contractId, userId, userPerspective, preAnalysisData) => {
    const contract = await findOwnedContract(contractId, userId);
    if (!contract) {
        await emitAnalysisProgress(null, contractId, { step: 'finalize', status: 'failed', message: '未找到合同记录。' });
        return;
    }

    try {
        // Step 1: 提取合同正文
        await emitAnalysisProgress(null, contractId, { step: 'extract_text', status: 'running', message: '正在提取合同正文...' });
        let plainText;
        try {
            plainText = await extractTextFromFile(contract.storage_path);
        } catch (extractError) {
            const errMsg = extractError.code === 'SCANNED_PDF'
                ? extractError.message
                : (extractError.code === 'EMPTY_TEXT' ? extractError.message : `合同正文提取失败：${extractError.message}`);
            await emitAnalysisProgress(null, contractId, { step: 'extract_text', status: 'failed', message: errMsg });
            return;
        }
        await emitAnalysisProgress(null, contractId, { step: 'extract_text', status: 'completed', message: `已提取合同正文（${String(plainText).length} 字）。` });

        let template = await getTemplateById(preAnalysisData.template_id);
        if (!template) {
            const matchResult = await matchTemplate(preAnalysisData.contract_type, plainText);
            // matchTemplate 可能返回混合合同数组,取第一个作为主模板
            template = Array.isArray(matchResult) ? (matchResult[0]?.template || null) : matchResult;
        }
        const reviewPoints = preAnalysisData.reviewPoints?.length ? preAnalysisData.reviewPoints : template.review_points;
        const corePurposes = preAnalysisData.core_purposes?.length ? preAnalysisData.core_purposes : template.core_purposes;

        // Step 2: 检索法条与案例依据
        await emitAnalysisProgress(null, contractId, { step: 'knowledge_search', status: 'running', message: '正在检索法条与案例依据...' });
        // 分析整个合同，法律条文适当增加检索范围，如果后续需要，再增加检索数量 30 -> n
        const relevantKnowledge = await getRelevantKnowledge({
            text: plainText,
            contractType: preAnalysisData.contract_type,
            reviewPoints,
            corePurposes,
            perspective: userPerspective,
        }, 40);
        await emitAnalysisProgress(null, contractId, { step: 'knowledge_search', status: 'completed', message: `法条与案例依据检索已完成（${relevantKnowledge.length} 条）。`, partialResult: { relevant_laws: await annotateKnowledgeUpdates(relevantKnowledge) } });

        // Step 3: 核验合同主体信息。专属知识库模式下禁止外部 API 和公网搜索。
        const knowledgeBaseOnly = isKnowledgeBaseOnlyMode();
        let companyNames = [];
        let companySearchResults = [];
        let companySearchContext = '';
        if (knowledgeBaseOnly) {
            await emitAnalysisProgress(null, contractId, {
                step: 'company_search',
                status: 'completed',
                message: '专属知识库模式已启用，已跳过外部主体核验。',
                partialResult: { company_search: [] },
            });
        } else {
            await emitAnalysisProgress(null, contractId, { step: 'company_search', status: 'running', message: '正在核验合同主体信息...' });
            companyNames = extractCompanyNames(plainText).slice(0, 3);
            companySearchResults = await Promise.all(
                companyNames.map(async (name) => {
                    try {
                        const profile = await verifyCompany(name);
                        return {
                            companyName: name,
                            profile,
                            results: [],
                            verifiedResults: [],
                            verified: profile.risk_level !== 'red',
                            source: profile.data_source,
                        };
                    } catch (error) {
                        console.error(`[companyVerify] 失败,回退网页搜索: ${name}`, error.message);
                        const webResult = await searchCompanyInfo(name);
                        return {
                            companyName: name,
                            profile: null,
                            results: webResult.results,
                            verifiedResults: webResult.verifiedResults,
                            verified: webResult.verified,
                            source: 'web_search',
                        };
                    }
                }),
            );
            await emitAnalysisProgress(null, contractId, { step: 'company_search', status: 'completed', message: `合同主体信息核验已完成（${companyNames.length} 个主体）。`, partialResult: { company_search: companySearchResults } });
            companySearchContext = companySearchResults.map((company, index) => {
                if (company.profile) {
                    const riskItemsText = company.profile.risk_items.length
                        ? company.profile.risk_items.map((item) => `  - ${item.type}: ${item.detail} (${item.date})`).join('\n')
                        : '  - 无风险事项';
                    return `${index + 1}. ${company.companyName}
风险等级: ${company.profile.risk_level === 'red' ? '红色(高风险)' : company.profile.risk_level === 'yellow' ? '黄色(中风险)' : '绿色(低风险)'}
统一社会信用代码: ${company.profile.unified_code || '未知'}
法定代表人: ${company.profile.legal_representative || '未知'}
企业状态: ${company.profile.company_status || '未知'}
风险事项:
${riskItemsText}
建议: ${company.profile.suggestion}
数据来源: ${company.profile.data_source}`;
                }
                const evidence = company.results.slice(0, 5).map((item, resultIndex) => (
                    `${resultIndex + 1}. [${item.engine}] ${item.title} ${item.url} 可信度:${item.authenticity_score} ${item.verified ? '已通过初步真实性检测' : '未通过真实性检测'} 摘要:${item.snippet}`
                )).join('\n');
                return `${index + 1}. ${company.companyName}\n${evidence || '未检索到可用外部证据'}`;
            }).join('\n');
        }

        // Step 3.5: 硬性合规检查（规则引擎）
        await emitAnalysisProgress(null, contractId, { step: 'rule_check', status: 'running', message: '正在执行硬性合规检查...' });
        let hardViolations = [];
        try {
            const externalValues = ruleEngine.loadExternalValues();
            const ruleResult = ruleEngine.runRules(plainText, template.id, externalValues);
            hardViolations = ruleResult.violations;
        } catch (ruleErr) {
            console.warn('[RuleEngine] 规则引擎执行失败:', ruleErr.message);
        }
        await emitAnalysisProgress(null, contractId, { step: 'rule_check', status: 'completed', message: `硬性合规检查完成，检出 ${hardViolations.length} 项违规。`, partialResult: { hard_violations: hardViolations } });

        // Step 4: AI 生成审查结论
        await emitAnalysisProgress(null, contractId, { step: 'llm_review', status: 'running', message: 'AI 正在深度审查合同，这是最耗时的步骤，请耐心等待...' });
        const prompt = `你是一名资深法务专家，请按审查模板对合同进行深度审查，并只输出 JSON。

审查模板：
- 模板名称：${template.name}
- 合同类型：${preAnalysisData.contract_type}
- 用户立场：${userPerspective}
- 审查点：${reviewPoints.join('；')}
- 审查目的：${corePurposes.join('；')}
- 模板规则：${(template.prompt_rules || []).join('；')}
- 报告结构偏好：${(template.report_sections || []).join('；')}

法律与裁判依据（向量 RAG + rerank 检索结果，只能引用以下内容，不得虚构法条、案号或裁判观点）：
${relevantKnowledge.map((item, index) => `[${index + 1}] [${item.source_type}] ${item.law} ${item.clause || ''}：${item.content}`).join('\n') || '未检索到直接依据。'}

输出 JSON 结构：
{
  "core_information": {
    "cost_business": [{"dimension":"付款节点/付款比例/工期或服务周期/材料价格调差/质保期及责任","original_clause":"合同原文","extracted_value":"精准摘取值"}],
    "legal_compliance": [{"dimension":"双方权利义务/违约责任/逾期责任/窝工责任/免责条款/终止解除","original_clause":"合同原文","extracted_value":"精准摘取值"}]
  },
  "template_differences": [{"template_source":"范本名称","template_clause":"范本原文","contract_clause":"合同原文","deviation":"偏离点","impact":"对成本或合规的影响"}],
  "compliance_findings": [{"issue_type":"范本差异/合规瑕疵/计算错误/文本错误","title":"待优化项标题","original_clause":"合同原文","basis":"知识库中的法规、案例、范本或审查要点","description":"问题及实务后果"}],
  "missing_clauses": [{"title":"缺失条款","description":"为什么缺失","suggested_clause":"可补充条款"}],
  "party_review": [{"title":"主体审查项","description":"审查结论","plain_language":"大白话说明"}],
  "modification_suggestions": [{"issue_type":"范本差异/合规瑕疵/计算错误/文本错误","operation":"replace/append","title":"建议标题","current_clause":"现状条款原文；新增条款时填写合同未约定","basis":[{"source_type":"law/case/template/review_rule","title":"依据名称","clause":"条号或范本条款","content":"依据原文"}],"suggested_text":"可直接替换或新增的完整条款","anchor_hint":"用于定位的短语"}],
  "breach_cost_analysis": [{"scenario":"违约场景","legal_basis":"知识库依据","estimated_cost":"可由合同明确计算的成本"}],
  "text_errors": [{"original_clause":"原文","description":"上下文矛盾、文字、数值或定义问题","suggested_text":"修正文本"}],
  "calculation_errors": [{"table_name":"表格名称","item":"错误项","original_value":"原值或公式","calculated_value":"复算值","description":"计算说明"}]
}

硬性要求：
- core_information 必须覆盖成本业务和法务合规维度；合同未约定的维度标明“合同未约定”，不得补造条款。
- 仅在检索结果中存在匹配范本或标准条款原文时输出 template_differences；没有范本依据时保持空数组，不得把通用经验冒充范本。
- compliance_findings 和 modification_suggestions 的 issue_type 只能是“范本差异”“合规瑕疵”“计算错误”“文本错误”之一。
- modification_suggestions 每一项必须包含 current_clause、basis 和 suggested_text；current_clause 必须尽量逐字摘录合同原文中的完整句子或段落。
- 合同已有原文需要修改时 operation 必须为 replace；合同缺失条款需要新增时 operation 必须为 append，current_clause 填“合同未约定”，不得把缺失说明伪装成可替换的合同原文。
- 必须逐条比对「法律与裁判依据」中每一条法律条文与合同对应条款，特别关注天数、期限、比例、金额、次数等强制性数字是否一致；合同条款与知识库依据不一致时，必须列入 compliance_findings 并给出对应的 modification_suggestions，不得遗漏。
- 如果没有检索依据，不得编造法条或案例，只能说明"当前知识库未检索到直接依据"。
- 不得调用或引用外部知识、模型记忆、未提供的境外法规、范本或案例。
- 全文禁止输出“风险等级”、高风险、中风险、低风险或同义分级；统一表述为“修改建议”或“待优化项”。
- 仅复算合同中明确可识别的表格数字或公式；无法可靠读取公式时说明“当前文件解析结果不足以复算”，不得猜测结果。
- 合同未涉及的业务不得凭空新增审查内容。
- 规则引擎已检出以下硬性违规（已生成修改建议），请勿在 compliance_findings 中重复列出：${hardViolations.length ? hardViolations.map(v => v.description).join('；') : '无'}
- 不输出自然语言解释，不输出 markdown。

合同原文：
---
${wrapContractContent(plainText)}
---`;

        const subjectSearchPrompt = knowledgeBaseOnly ? '' : `\n\n主体外部核验证据(优先为第三方企业数据 API 风险画像,部分为 Bing/Baidu 网页搜索回退):\n${companySearchContext || '未识别到可检索的公司主体名称。'}\n\n请额外输出 company_review 字段,结构为 [{"company_name":"公司名称","risk_level":"red/yellow/green","risk_items":[{"type":"类型","detail":"详情","date":"日期"}],"suggestion":"基于风险等级的建议措施","status":"核验状态","evidence_summary":"核验摘要","authenticity":"真实性结论","sources":["URL"]}。红色主体建议要求担保或拒绝签约,黄色主体建议加强资信调查,绿色主体无重大风险。`;
        const contractCharCount = plainText.length;
        const LONG_CONTRACT_THRESHOLD = 8000; // 短/长合同分界（字符数）
        let analysisResult;
        if (contractCharCount < LONG_CONTRACT_THRESHOLD) {
            // 短合同：原整篇审查（保持现有逻辑）
            analysisResult = normalizeAnalysisResult(await callJsonLLM(prompt + subjectSearchPrompt), plainText);
        } else {
            // 长合同：条款树分层审查，逐条独立召回法条 + LLM 审查
            const clauses = contractParser.parseContractTree(plainText);
            // 动态 ETA：基础 60s + 每条 10s（Task 2.5）
            updateAnalysisJob(contractId, { totalEstSeconds: TOTAL_EST_SECONDS + clauses.length * 10 });
            const truncatedClauses = [];
            const clauseResults = [];
            // 召回阶段并发 8（IO 密集，向量检索+rerank 快）；LLM 阶段并发 6（受 API RPM 限流）
            const RECALL_CONCURRENCY = 8;
            const LLM_CONCURRENCY = 6;

            // Phase 1: 并发召回所有条款的法条依据（与 LLM 审查解耦，避免 LLM 等待召回串行）
            const recalled = []; // { clause, knowledge }
            for (let i = 0; i < clauses.length; i += RECALL_CONCURRENCY) {
                const chunk = clauses.slice(i, i + RECALL_CONCURRENCY);
                const results = await Promise.all(chunk.map(async (clause) => {
                    const tokenCount = contractParser.estimateTokenCount(clause.text);
                    if (tokenCount > 6000) {
                        // 条款超长（留 2000 token 给 prompt 其他部分），记入截断清单
                        truncatedClauses.push({
                            clause_id: clause.clause_id,
                            char_count: clause.char_count,
                            estimated_tokens: tokenCount,
                            reason: '条款超长,未完整审查',
                        });
                        return null;
                    }
                    try {
                        const knowledge = await getRelevantKnowledge({ byClause: true, clauses: [clause] }, 8);
                        return { clause, knowledge };
                    } catch (err) {
                        truncatedClauses.push({ clause_id: clause.clause_id, reason: `法条检索失败: ${err.message}` });
                        return null;
                    }
                }));
                results.forEach(r => { if (r) recalled.push(r); });
            }

            // Phase 2: 并发 LLM 审查（使用预召回的法条，避免 LLM 等待召回串行）
            for (let i = 0; i < recalled.length; i += LLM_CONCURRENCY) {
                const chunk = recalled.slice(i, i + LLM_CONCURRENCY);
                const results = await Promise.all(chunk.map(async ({ clause, knowledge: clauseKnowledge }) => {
                    const clausePrompt = `你是一名资深法务专家，正在对一份长合同进行条款树分层审查。当前只需审查以下单个条款，并只输出 JSON。

审查模板：
- 模板名称：${template.name}
- 合同类型：${preAnalysisData.contract_type}
- 用户立场：${userPerspective}
- 审查点：${reviewPoints.join('；')}
- 审查目的：${corePurposes.join('；')}
- 模板规则：${(template.prompt_rules || []).join('；')}

当前条款编号：${clause.clause_id}
当前条款层级：${clause.path.join(' > ') || '无'}

法律与裁判依据（仅针对该条款检索，只能引用以下内容，不得虚构法条、案号或裁判观点）：
${clauseKnowledge.map((item, index) => `[${index + 1}] [${item.source_type}] ${item.law} ${item.clause || ''}：${item.content}`).join('\n') || '未检索到直接依据。'}

输出 JSON 结构（仅输出与该条款相关的项，无则空数组）：
{
  "core_information": {"cost_business":[{"dimension":"成本维度","original_clause":"合同原文","extracted_value":"摘取值"}],"legal_compliance":[{"dimension":"法务维度","original_clause":"合同原文","extracted_value":"摘取值"}]},
  "template_differences": [{"template_source":"范本名称","template_clause":"范本原文","contract_clause":"合同原文","deviation":"偏离点","impact":"对成本或合规的影响"}],
  "compliance_findings": [{"issue_type":"范本差异/合规瑕疵/计算错误/文本错误","title":"待优化项标题","original_clause":"合同原文","basis":"知识库依据","description":"问题及实务后果"}],
  "missing_clauses": [{"title":"缺失条款","description":"为什么缺失","suggested_clause":"可补充条款"}],
  "party_review": [{"title":"主体审查项","description":"审查结论","plain_language":"大白话说明"}],
  "modification_suggestions": [{"issue_type":"范本差异/合规瑕疵/计算错误/文本错误","operation":"replace/append","title":"建议标题","current_clause":"现状条款原文；新增条款时填写合同未约定","basis":[{"source_type":"law/case/template/review_rule","title":"依据名称","clause":"条号或范本条款","content":"依据原文"}],"suggested_text":"可直接替换或新增的完整条款","anchor_hint":"用于定位的短语"}],
  "breach_cost_analysis": [{"scenario":"违约场景","legal_basis":"知识库依据","estimated_cost":"可由合同明确计算的成本"}],
  "text_errors": [{"original_clause":"原文","description":"上下文矛盾、文字、数值或定义问题","suggested_text":"修正文本"}],
  "calculation_errors": [{"table_name":"表格名称","item":"错误项","original_value":"原值或公式","calculated_value":"复算值","description":"计算说明"}]
}

硬性要求：
- 仅摘取和审查当前条款实际涉及的内容，不得凭空补充其他业务。
- 仅在检索结果中存在范本或标准条款原文时输出 template_differences；没有依据时保持空数组。
- compliance_findings 和 modification_suggestions 的 issue_type 只能是“范本差异”“合规瑕疵”“计算错误”“文本错误”之一。
- modification_suggestions 每一项必须包含 current_clause、basis 和 suggested_text，current_clause 必须逐字摘录当前条款原文。
- 合同已有原文需要修改时 operation 必须为 replace；合同缺失条款需要新增时 operation 必须为 append，current_clause 填“合同未约定”。
- 必须逐条比对「法律与裁判依据」与当前条款，特别关注天数、期限、比例、金额、次数等强制性数字；不一致时必须列入 compliance_findings 并给出 modification_suggestions。
- 如果没有检索依据，不得编造法条或案例，只能说明"当前知识库未检索到直接依据"。
- 不得调用或引用外部知识、模型记忆、未提供的境外法规、范本或案例。
- 全文禁止输出“风险等级”、高风险、中风险、低风险或同义分级；统一表述为“修改建议”或“待优化项”。
- 规则引擎已检出以下硬性违规（已生成修改建议），请勿在 compliance_findings 中重复列出：${hardViolations.length ? hardViolations.map((v) => v.description).join('；') : '无'}
- 不输出自然语言解释，不输出 markdown。

当前条款原文：
---
${clause.text}
---`;
                    // 推送条款级进度；并发下 reviewed 为已完成条款数(每 chunk 结束后更新,近似值)
                    getIoInstance()?.to(`contract-${contractId}`).emit('clause_progress', {
                        contractId: Number(contractId),
                        reviewed: clauseResults.length,
                        total: clauses.length,
                        current_clause_id: clause.clause_id,
                    });
                    try {
                        const clauseResult = normalizeAnalysisResult(await callJsonLLM(clausePrompt), clause.text || '');
                        clauseResult.clause_id = clause.clause_id;
                        return clauseResult;
                    } catch (clauseErr) {
                        truncatedClauses.push({ clause_id: clause.clause_id, reason: `LLM 失败: ${clauseErr.message}` });
                        return null;
                    }
                }));
                results.forEach(r => { if (r) clauseResults.push(r); });
            }
            // 聚合各条款结果（去重 + 跨条款一致性标注）
            analysisResult = aggregateClauseResults(clauseResults);
            analysisResult.truncated_clauses = truncatedClauses;
        }
        analysisResult.relevant_laws = await annotateKnowledgeUpdates(relevantKnowledge);
        analysisResult.company_search = companySearchResults;
        if (!analysisResult.company_review.length && companySearchResults.length) {
            analysisResult.company_review = companySearchResults.map((company) => {
                if (company.profile) {
                    // 新路径:用 CompanyRiskProfile 填充
                    return {
                        company_name: company.companyName,
                        risk_level: company.profile.risk_level,
                        risk_items: company.profile.risk_items,
                        suggestion: company.profile.suggestion,
                        status: company.profile.risk_level === 'green' ? '主体状态正常' : `存在${company.profile.risk_level === 'red' ? '高' : '中'}风险`,
                        evidence_summary: `统一社会信用代码:${company.profile.unified_code || '未知'};法定代表人:${company.profile.legal_representative || '未知'};企业状态:${company.profile.company_status || '未知'}`,
                        authenticity: `数据来源:${company.profile.data_source}`,
                        sources: [],
                    };
                }
                // 二级回退:网页搜索结果(保留原逻辑)
                return {
                    company_name: company.companyName,
                    risk_level: 'green',
                    risk_items: [],
                    suggestion: '网页搜索未提供足够风险数据,建议通过国家企业信用信息公示系统手动核验',
                    status: company.verifiedResults.length ? '已检索到可初步核验的主体线索' : '未检索到足够可靠的主体证据',
                    evidence_summary: company.verifiedResults[0]?.snippet || company.results[0]?.snippet || '外部搜索未返回足够证据。',
                    authenticity: company.verifiedResults.length ? '存在官方或多源交叉线索，仍需以国家企业信用信息公示系统等正式渠道为准。' : '搜索结果未通过基础真实性检测，不能据此下结论。',
                    sources: (company.verifiedResults.length ? company.verifiedResults : company.results).slice(0, 3).map((item) => item.url),
                };
            });
        }
        analysisResult.hard_violations = hardViolations;
        // 去重:剔除 dispute_points 中与 hardViolations 标题重复的项(代码级保障,避免 LLM 未遵循 prompt 指令)
        if (Array.isArray(analysisResult.dispute_points) && hardViolations.length) {
            const hardTitles = hardViolations.map(v => v.description);
            analysisResult.dispute_points = analysisResult.dispute_points.filter(dp => {
                const dpTitle = String(dp.title || '').trim();
                if (!dpTitle) return true;
                // 完全匹配或高度包含
                return !hardTitles.some(ht => ht === dpTitle || ht.includes(dpTitle) || dpTitle.includes(ht));
            });
        }
        analysisResult.template = {
            id: template.id,
            name: template.name,
            report_sections: template.report_sections || [],
        };
        await emitAnalysisProgress(null, contractId, { step: 'llm_review', status: 'completed', message: 'AI 审查结论已生成。' });

        // Step 5: 印章与签章核验
        await emitAnalysisProgress(null, contractId, { step: 'seal_analysis', status: 'running', message: '正在进行印章与签章核验...' });
        analysisResult.seal_analysis = analysisResult.seal_analysis.length
            ? analysisResult.seal_analysis
            : await analyzeSealAndSignature(contract, plainText);
        await emitAnalysisProgress(null, contractId, { step: 'seal_analysis', status: 'completed', message: '印章与签章核验已完成。' });

        // Step 5.5: 行业标准条款对比(P3 4.3) - 失败降级,不中断审查
        try {
            analysisResult.standard_comparison = await buildStandardComparison(plainText, preAnalysisData?.contract_type || contract.contract_type || '');
        } catch (stdErr) {
            console.warn('[Analysis] standard_comparison failed, skipping:', stdErr.message);
            analysisResult.standard_comparison = [];
        }

        // Step 6: 保存结果
        await emitAnalysisProgress(null, contractId, { step: 'finalize', status: 'running', message: '正在保存审查结果...' });
        await db('contracts').where({ id: contractId }).update({
            status: 'Reviewed',
            analysis_status: 'reviewed',
            analysis_result: JSON.stringify(analysisResult),
            analysis_partial_result: JSON.stringify(analysisResult),
            pre_analysis_data: JSON.stringify(preAnalysisData),
            perspective: userPerspective,
        });

        updateAnalysisJob(contractId, { status: 'completed', result: analysisResult, percent: 100 });
        await emitAnalysisProgress(null, contractId, { step: 'finalize', status: 'completed', message: '审查结果已保存。', partialResult: analysisResult });
        if (getIoInstance()) getIoInstance().to(`contract-${contractId}`).emit('analysis-complete', { results: analysisResult, perspective: userPerspective });
    } catch (error) {
        console.error('Error during background AI analysis:', error);
        updateAnalysisJob(contractId, { status: 'failed', error: error.message });
        await emitAnalysisProgress(null, contractId, { step: 'failed', status: 'failed', message: `分析失败：${error.message}` });
        if (getIoInstance()) getIoInstance().to(`contract-${contractId}`).emit('analysis-failed', { error: error.message });
    }
};

module.exports = {
    runAnalysisInBackground,
};
