/**
 * @file routes/contracts/exportRoutes.js
 * @brief 审查报告导出、PDF 批注、强制保存与编辑器配置路由
 *
 * 核心职责：
 * - 导出审查报告（PDF/DOCX/HTML 三种格式）
 * - 导出 PDF 合同批注意见为文本
 * - 触发 OnlyOffice 强制保存（force-save）
 * - 获取最新的 OnlyOffice 编辑器配置
 *
 * 关键实现：
 * - DOCX 导出使用真正的 OOXML 格式
 * - 强制保存通过 postOnlyOfficeCommand 调用 OnlyOffice 服务
 *
 * 依赖关系：
 * - 上游：database、services/contractAnalysis（auth、reportRendering、onlyoffice）
 * - 下游：被 routes/contracts/index.js 注册
 */
const db = require('../../database');
const path = require('path');
const { requireRequestUserId, findOwnedContract } = require('../../services/contractAnalysis/auth');
const { parseJsonField, renderReviewReportHtml, generateDocxBuffer, streamReviewReportPdf } = require('../../services/contractAnalysis/reportRendering');
const { postOnlyOfficeCommand, buildOnlyOfficeConfig } = require('../../services/contractAnalysis/onlyoffice');

module.exports = function (router) {
    router.get('/:id/export-report', async (req, res) => {
        const userId = requireRequestUserId(req, res);
        if (!userId) return;
        const contract = await findOwnedContract(req.params.id, userId);
        if (!contract) return res.status(404).json({ error: 'Contract not found.' });

        const format = String(req.query.format || 'html').toLowerCase();
        const reviewData = parseJsonField(contract.analysis_result, parseJsonField(contract.analysis_partial_result, {}));
        const basename = path.basename(contract.original_filename, path.extname(contract.original_filename)).replace(/[^a-zA-Z0-9._-]/g, '_') || 'contract';

        if (format === 'pdf') {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${basename}-review-report.pdf"`);
            return streamReviewReportPdf(res, contract, reviewData);
        }

        if (format === 'word' || format === 'docx') {
            // 真正的 DOCX 格式（OOXML），非 HTML 伪装
            const docxBuffer = generateDocxBuffer(contract, reviewData);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            res.setHeader('Content-Disposition', `attachment; filename="${basename}-review-report.docx"`);
            return res.send(docxBuffer);
        }

        const html = renderReviewReportHtml(contract, reviewData, format);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${basename}-review-report.html"`);
        res.send(html);
    });

    router.get('/:id/pdf-annotations', async (req, res) => {
        const userId = requireRequestUserId(req, res);
        if (!userId) return;
        const contract = await findOwnedContract(req.params.id, userId);
        if (!contract) return res.status(404).json({ error: 'Contract not found.' });

        const reviewData = parseJsonField(contract.analysis_result, parseJsonField(contract.analysis_partial_result, {}));
        const suggestions = reviewData.modification_suggestions || [];
        const lines = [
            `PDF 合同批注意见：${contract.original_filename}`,
            `导出时间：${new Date().toISOString()}`,
            '',
            ...suggestions.flatMap((item, index) => [
                `#${index + 1} ${item.title || item.clause || '修改建议'}`,
                `现状条款：${item.current_clause || item.original_text || item.original_clause || ''}`,
                `建议修改为：${item.suggested_text || item.modification || ''}`,
                `依据：${Array.isArray(item.basis) ? item.basis.map((basis) => [basis.title, basis.clause, basis.content].filter(Boolean).join(' ')).join('；') : (item.basis || item.reason || item.rationale || '当前知识库未检索到直接依据')}`,
                '',
            ]),
        ];
        const basename = path.basename(contract.original_filename, path.extname(contract.original_filename)).replace(/[^a-zA-Z0-9._-]/g, '_') || 'contract';
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${basename}-pdf-annotations.txt"`);
        res.send(lines.join('\n'));
    });

    router.post('/:id/force-save', async (req, res) => {
        const userId = req.header('X-User-ID');
        const { documentKey } = req.body || {};
        if (!userId) return res.status(401).json({ error: 'User ID is required for access.' });

        try {
            const contract = await db('contracts').where({ id: req.params.id, user_id: userId }).first();
            if (!contract) return res.status(404).json({ error: 'Contract not found or you do not have permission to access it.' });
            const key = String(documentKey || contract.document_key || '').trim();
            if (!key) return res.status(400).json({ error: 'Document key is required for force-save.' });

            const result = await postOnlyOfficeCommand({
                c: 'forcesave',
                key,
            });

            if (result?.error && result.error !== 0) {
                return res.status(502).json({ error: `OnlyOffice force-save failed: ${result.error}`, result });
            }

            res.json({ ok: true, result });
        } catch (error) {
            console.error(`[ERROR] Failed to force-save contract ${req.params.id}:`, error.response?.data || error.message);
            res.status(500).json({ error: 'Failed to trigger OnlyOffice force-save.' });
        }
    });

    router.get('/:id/editor-config', async (req, res) => {
        const { id } = req.params;
        const userId = req.header('X-User-ID');
        if (!userId) return res.status(401).json({ error: 'User ID is required for access.' });

        try {
            const contractRecord = await db('contracts').where({ id, user_id: userId }).first();
            if (!contractRecord) return res.status(404).json({ error: 'Contract not found or you do not have permission to access it.' });

            const ext = path.extname(contractRecord.storage_path).toLowerCase().replace('.', '') || 'docx';
            res.json({
                editorConfig: buildOnlyOfficeConfig(contractRecord, ext),
            });
        } catch (error) {
            console.error(`[ERROR] Failed to fetch fresh editor config for id ${id}:`, error);
            res.status(500).json({ error: 'Server error while fetching editor config.' });
        }
    });
};
