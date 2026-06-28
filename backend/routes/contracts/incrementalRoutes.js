/**
 * @file routes/contracts/incrementalRoutes.js
 * @brief 条款级增量审查与谈判博弈模拟路由
 *
 * 核心职责：
 * - review-incremental：对比上一版本仅重审变更条款
 * - simulate-negotiation：批量模拟相对方立场反向论证修改建议
 *
 * 关键实现：
 * - 基于 diffClauses 计算变更条款，无变更则跳过重审
 * - 增量结果追加到 analysis_result.incremental_reviews
 * - 谈判模拟支持按 suggestionIds 过滤目标建议
 *
 * 依赖关系：
 * - 上游：database、services/contractAnalysis（auth、fileExtraction、reportRendering）、services/incrementalReview、services/reviewTemplates、services/webSearch、services/negotiationSimulator
 * - 下游：被 routes/contracts/index.js 注册
 */
const db = require('../../database');
const { requireRequestUserId, findOwnedContract } = require('../../services/contractAnalysis/auth');
const { extractTextFromFile } = require('../../services/contractAnalysis/fileExtraction');
const { diffClauses, runIncrementalReview } = require('../../services/incrementalReview');
const { parseJsonField } = require('../../services/contractAnalysis/reportRendering');
const { getTemplateById, matchTemplate } = require('../../services/reviewTemplates');
const { extractCompanyNames } = require('../../services/webSearch');
const { inferCounterpartyPerspective, simulateNegotiationBatch } = require('../../services/negotiationSimulator');

module.exports = function (router) {
    // 3.1 条款级增量审查:对比当前文本与上一审查版本,仅对变更条款重新审查
    router.post('/:id/review-incremental', async (req, res) => {
        const userId = requireRequestUserId(req, res);
        if (!userId) return;
        const contract = await findOwnedContract(req.params.id, userId);
        if (!contract) return res.status(404).json({ error: 'Contract not found.' });

        try {
            const newText = await extractTextFromFile(contract.storage_path);

            // 上一审查版本:取最近一次保存的合同版本快照
            const lastVersion = await db('contract_versions')
                .where({ contract_id: contract.id })
                .orderBy('version_no', 'desc')
                .first();
            const oldText = lastVersion?.plain_text || '';

            const diffs = diffClauses(oldText, newText);
            const needsReview = diffs.filter((d) => d.needs_review);
            if (needsReview.length === 0) {
                return res.json({ message: '无变更,无需重审', diff_clauses: [], new_risks: [], resolved_risks: [], reviewed_at: new Date().toISOString() });
            }

            // 历史风险点 + 模板
            const existing = parseJsonField(contract.analysis_result, parseJsonField(contract.analysis_partial_result, {}));
            const origPoints = Array.isArray(existing.dispute_points) ? existing.dispute_points : [];
            const templateId = req.body?.templateId || existing.template_id || contract.contract_type || null;
            let template = templateId ? await getTemplateById(templateId) : null;
            if (!template) {
                const matchResult = await matchTemplate(contract.contract_type || '', newText);
                template = Array.isArray(matchResult) ? (matchResult[0]?.template || null) : matchResult;
            }

            const incrementalResult = await runIncrementalReview(contract.id, diffs, origPoints, { template });

            // 保存到 analysis_result.incremental_reviews(数组,追加本次审查记录)
            const updatedAnalysisResult = { ...existing };
            const reviews = Array.isArray(updatedAnalysisResult.incremental_reviews) ? updatedAnalysisResult.incremental_reviews : [];
            reviews.push({
                reviewed_at: incrementalResult.reviewed_at,
                diff_summary: {
                    modified: incrementalResult.diff_clauses.filter((d) => d.change_type === 'modified').length,
                    added: incrementalResult.diff_clauses.filter((d) => d.change_type === 'added').length,
                    deleted: incrementalResult.diff_clauses.filter((d) => d.change_type === 'deleted').length,
                },
                new_risks: incrementalResult.new_risks,
                resolved_risks: incrementalResult.resolved_risks,
                from_version_no: lastVersion?.version_no || null,
            });
            updatedAnalysisResult.incremental_reviews = reviews;
            // 同步标记最近一次 resolved 风险,便于 UI 灰显
            if (incrementalResult.resolved_risks.length > 0) {
                updatedAnalysisResult.dispute_points = origPoints.map((dp) => (
                    incrementalResult.resolved_risks.includes(dp.title)
                        ? { ...dp, resolved: true }
                        : dp
                ));
            }

            await db('contracts').where({ id: contract.id }).update({
                analysis_result: JSON.stringify(updatedAnalysisResult),
                updated_at: db.fn.now(),
            });

            res.json(incrementalResult);
        } catch (error) {
            console.error('[ERROR] Incremental review failed:', error);
            res.status(500).json({ error: `增量审查失败:${error.message}` });
        }
    });

    // 4.1 谈判博弈模拟:对修改建议批量模拟对方立场反向论证
    router.post('/:id/simulate-negotiation', async (req, res) => {
        const userId = requireRequestUserId(req, res);
        if (!userId) return;
        const contract = await findOwnedContract(req.params.id, userId);
        if (!contract) return res.status(404).json({ error: 'Contract not found.' });

        try {
            const { suggestionIds, counterpartyPerspective } = req.body || {};
            const reviewData = parseJsonField(contract.analysis_result, parseJsonField(contract.analysis_partial_result, {}));
            const allSuggestions = Array.isArray(reviewData.modification_suggestions) ? reviewData.modification_suggestions : [];

            // 筛选目标建议:若指定 suggestionIds 则按 id 过滤,否则取全部
            let targetSuggestions = allSuggestions;
            if (Array.isArray(suggestionIds) && suggestionIds.length) {
                targetSuggestions = allSuggestions.filter((s) => suggestionIds.includes(s.id) || suggestionIds.includes(String(s.id)));
                if (targetSuggestions.length === 0) {
                    return res.status(404).json({ error: '未找到指定的修改建议。' });
                }
            }
            if (targetSuggestions.length === 0) {
                return res.status(400).json({ error: '当前合同没有可推演的修改建议。' });
            }

            // 构造合同上下文
            let plainText = '';
            try {
                plainText = await extractTextFromFile(contract.storage_path);
            } catch (e) {
                console.warn('[Negotiation] extract text failed:', e.message);
            }
            const contractContext = {
                contract_type: contract.contract_type || '',
                summary: plainText.slice(0, 1500),
                user_perspective: contract.perspective || '',
                parties: extractCompanyNames(plainText),
            };
            const counterPerspective = counterpartyPerspective
                || inferCounterpartyPerspective(contractContext.user_perspective, contractContext);

            const results = await simulateNegotiationBatch(targetSuggestions, contractContext, counterPerspective);
            res.json({ counterparty_perspective: counterPerspective, results });
        } catch (error) {
            console.error('[ERROR] Negotiation simulation failed:', error);
            res.status(500).json({ error: `谈判推演失败:${error.message}` });
        }
    });
};
