/**
 * @file routes/contracts/analyzeRoutes.js
 * @brief 合同预分析、完整分析、状态查询与文本专项审查路由
 *
 * 核心职责：
 * - pre-analyze：解析合同文本，识别类型/审查点并匹配模板
 * - analyze：创建异步分析任务并立即返回 jobId
 * - analyze-status：查询任务进度（支持断线恢复）
 * - review-text：对选中文本进行专项审查并持久化
 *
 * 关键实现：
 * - 完整分析在后台异步执行，避免长耗时阻塞请求
 * - 重复分析请求返回 409
 * - 专项审查结合知识库检索 + 模板，结果写入 focused_reviews 表
 *
 * 依赖关系：
 * - 上游：database、services/contractAnalysis（auth、fileExtraction、analysisJob、llm、backgroundAnalysis、knowledge）、services/reviewTemplates
 * - 下游：被 routes/contracts/index.js 注册
 */
const db = require('../../database');
const { requireRequestUserId, getRequestUserId, findOwnedContract } = require('../../services/contractAnalysis/auth');
const { extractTextFromFile, wrapContractContent } = require('../../services/contractAnalysis/fileExtraction');
const { emitAnalysisProgress, createAnalysisJob, ANALYSIS_STEPS, TOTAL_EST_SECONDS, analysisJobs } = require('../../services/contractAnalysis/analysisJob');
const { callJsonLLM } = require('../../services/contractAnalysis/llm');
const { matchTemplate, getTemplateById } = require('../../services/reviewTemplates');
const { getRelevantKnowledge, annotateKnowledgeUpdates } = require('../../services/contractAnalysis/knowledge');
const { parseJsonField } = require('../../services/contractAnalysis/reportRendering');
const { runAnalysisInBackground } = require('../../services/contractAnalysis/backgroundAnalysis');

module.exports = function (router) {
    router.post('/pre-analyze', async (req, res) => {
        const { contractId } = req.body;
        if (!contractId) return res.status(400).json({ error: 'Contract ID is required.' });
        const userId = requireRequestUserId(req, res);
        if (!userId) return;

        try {
            const contract = await findOwnedContract(contractId, userId);
            if (!contract) return res.status(404).json({ error: 'Contract not found.' });

            let plainText;
            try {
                plainText = await extractTextFromFile(contract.storage_path);
            } catch (extractError) {
                if (extractError.code === 'SCANNED_PDF') {
                    return res.status(422).json({
                        error: extractError.message,
                        code: 'SCANNED_PDF',
                        scanInfo: extractError.scanInfo,
                    });
                }
                if (extractError.code === 'EMPTY_TEXT') {
                    return res.status(422).json({
                        error: extractError.message,
                        code: 'EMPTY_TEXT',
                    });
                }
                throw extractError;
            }

            // 提供文本字数与预览，让用户确认解析是否正确（issue 1.4）
            const textPreview = String(plainText).replace(/\s+/g, ' ').trim().slice(0, 200);
            const textStats = {
                charCount: String(plainText).length,
                preview: textPreview,
            };

            await emitAnalysisProgress(req, contractId, { step: 'pre_analysis', status: 'running', message: '正在进行合同预分析。' });
            const prompt = `你是专业法务助手。阅读合同后只输出 JSON：
{
  "contract_type": "合同类型",
  "potential_parties": ["可选审查立场"],
  "suggested_review_points": ["关键审查点"],
  "suggested_core_purposes": ["核心审查目的"]
}

要求：
- 审查点和目的必须具体，优先贴合合同类型。
- 不输出自然语言解释。

合同原文：
---
${wrapContractContent(plainText)}
---`;
            const analysisResult = await callJsonLLM(prompt);
            const matchResult = await matchTemplate(analysisResult.contract_type, plainText);
            // matchTemplate 返回单模板对象或混合合同数组;数组时取第一个作为主模板
            const template = Array.isArray(matchResult) ? (matchResult[0]?.template || null) : matchResult;
            analysisResult.template_id = template?.id || 'general';
            analysisResult.template_name = template?.name || '通用合同审查模板';
            analysisResult.suggested_template_id = template?.id || 'general';
            analysisResult.available_templates = undefined;
            analysisResult.suggested_review_points = Array.from(new Set([
                ...(template?.review_points || []),
                ...(analysisResult.suggested_review_points || []),
            ]));
            analysisResult.suggested_core_purposes = Array.from(new Set([
                ...(template?.core_purposes || []),
                ...(analysisResult.suggested_core_purposes || []),
            ]));
            analysisResult.text_stats = textStats;

            await db('contracts').where({ id: contractId }).update({
                status: 'PreAnalyzed',
                analysis_status: 'pre_analyzed',
                pre_analysis_data: JSON.stringify(analysisResult),
            });
            await emitAnalysisProgress(req, contractId, { step: 'pre_analysis', status: 'completed', message: '合同预分析已完成。', partialResult: { preAnalysisData: analysisResult } });
            res.json(analysisResult);
        } catch (error) {
            console.error(`[ERROR] Pre-analysis failed for contract ${contractId}:`, error);
            res.status(500).json({ error: '预分析失败，请稍后重试。' });
        }
    });

    router.post('/analyze', async (req, res) => {
        const { contractId, userPerspective, preAnalysisData } = req.body;
        if (!contractId || !userPerspective || !preAnalysisData?.contract_type) {
            return res.status(400).json({ error: 'Incomplete analysis request. A full preAnalysisData object is required.' });
        }
        const userId = requireRequestUserId(req, res);
        if (!userId) return;

        try {
            const contract = await findOwnedContract(contractId, userId);
            if (!contract) return res.status(404).json({ error: 'Contract not found.' });

            // 若该合同已有正在运行的分析任务，拒绝重复触发
            const existingJob = analysisJobs.get(Number(contractId));
            if (existingJob && existingJob.status === 'running') {
                return res.status(409).json({ error: '该合同正在分析中，请等待当前分析完成。', jobId: existingJob.jobId });
            }

            // 创建分析任务并立即返回 jobId，后台异步执行
            const job = createAnalysisJob(contractId, userId);
            await db('contracts').where({ id: contractId }).update({
                analysis_status: 'analyzing',
                updated_at: db.fn.now(),
            });

            // 立即响应，不等分析完成
            res.status(202).json({
                jobId: job.jobId,
                contractId: Number(contractId),
                message: '分析任务已启动，请通过实时进度追踪查看状态。',
                steps: ANALYSIS_STEPS.map((s) => ({ key: s.key, label: s.label, weight: s.weight })),
                estimatedTotalSeconds: TOTAL_EST_SECONDS,
            });

            // 后台异步执行（不 await）
            runAnalysisInBackground(contractId, userId, userPerspective, preAnalysisData).catch((err) => {
                console.error('[ANALYSIS] Background task crashed:', err);
            });
        } catch (error) {
            console.error('Error starting AI analysis:', error);
            res.status(500).json({ error: '启动分析任务失败。' });
        }
    });

    // 查询分析任务状态（用于断线恢复）
    router.get('/analyze-status/:contractId', async (req, res) => {
        const userId = requireRequestUserId(req, res);
        if (!userId) return;
        const contractId = Number(req.params.contractId);
        const job = analysisJobs.get(contractId);

        // 若内存任务不存在，回退到数据库状态
        if (!job) {
            const contract = await findOwnedContract(contractId, userId);
            if (!contract) return res.status(404).json({ error: 'Contract not found.' });
            const hasResult = Boolean(contract.analysis_result);
            return res.json({
                contractId,
                status: hasResult ? 'completed' : (contract.analysis_status || 'idle'),
                percent: hasResult ? 100 : 0,
                steps: ANALYSIS_STEPS.map((s) => ({ ...s, status: hasResult ? 'completed' : 'pending', message: '' })),
                result: hasResult ? parseJsonField(contract.analysis_result, null) : null,
            });
        }

        res.json({
            contractId,
            jobId: job.jobId,
            status: job.status,
            percent: job.percent,
            currentStep: job.currentStep,
            elapsedSeconds: Math.round((Date.now() - job.startedAt) / 1000),
            steps: job.steps,
            error: job.error,
            result: job.result,
        });
    });

    router.post('/review-text', async (req, res) => {
        const { text, question, perspective, contractType, templateId, contractId } = req.body;
        if (!text || !String(text).trim()) return res.status(400).json({ error: 'Text is required for focused review.' });

        try {
            let template = await getTemplateById(templateId);
            if (!template) {
                const matchResult = await matchTemplate(contractType || '', text);
                // matchTemplate 可能返回混合合同数组,取第一个作为主模板
                template = Array.isArray(matchResult) ? (matchResult[0]?.template || null) : matchResult;
            }
            const relevantKnowledge = await getRelevantKnowledge({
                text,
                contractType: contractType || template.name,
                reviewPoints: template.review_points || [],
                corePurposes: template.core_purposes || [],
                question,
                perspective,
            }, 8);
            const prompt = `你是专业合同审查助手。用户选中了合同中的一段文本，请进行专项审查，只输出 JSON。

审查模板：${template.name}
审查立场：${perspective || '未指定'}
专项问题：${question || '识别该段文本的法律风险、可修改点，并给出可替换文本。'}

可引用依据（只能引用以下内容，不得虚构）：
${relevantKnowledge.map((item, index) => `[${index + 1}] [${item.source_type}] ${item.law} ${item.clause || ''}：${item.content}`).join('\n') || '未检索到直接依据。'}

待审查文本：
---
${wrapContractContent(text)}
---

硬性要求：
- 必须逐条比对「可引用依据」中每一条法律条文与待审查文本，特别关注天数、期限、比例、金额、次数等强制性数字是否一致；若存在不一致（例如法定 15 日被写成 30 日），必须在 risk_summary 中明确指出并在 suggested_text 中修正。
- 如果没有检索依据，不得编造法条或案例，只能说明"当前知识库未检索到直接依据"。
- 只输出 JSON，不输出自然语言解释，不输出 markdown。

输出 JSON：
{
  "risk_summary": "风险结论",
  "suggested_text": "可直接替换原文的完整文本；如无需修改则为空字符串",
  "reason": "专业理由",
  "plain_language": "大白话说明",
  "citations": [{"source_type":"law/case","title":"依据名称","clause":"条号或片段","content":"引用内容"}]}`;
            const parsed = await callJsonLLM(prompt);
            parsed.relevant_laws = await annotateKnowledgeUpdates(relevantKnowledge);

            // 持久化到数据库（如果提供了 contractId）
            const numericContractId = Number(contractId);
            if (Number.isInteger(numericContractId) && numericContractId > 0) {
                const userId = getRequestUserId(req);
                try {
                    const [inserted] = await db('focused_reviews').insert({
                        contract_id: numericContractId,
                        user_id: userId,
                        source_text: String(text),
                        question: question || null,
                        perspective: perspective || null,
                        contract_type: contractType || null,
                        template_id: templateId || null,
                        result: JSON.stringify(parsed),
                    }).returning('id');
                    parsed.focused_review_id = typeof inserted === 'object' ? inserted.id : inserted;
                    parsed.saved_at = new Date().toISOString();
                } catch (saveError) {
                    console.warn('[WARN] Failed to persist focused review:', saveError.message);
                }
            }

            res.json(parsed);
        } catch (error) {
            console.error('[ERROR] Focused review failed:', error);
            res.status(500).json({ error: 'Focused review failed.' });
        }
    });
};
