/**
 * @file routes/contracts/textEditRoutes.js
 * @brief 合同 DOCX 的直接编辑与审阅修订路由
 */
const db = require('../../database');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');
const { requireRequestUserId, findOwnedContract } = require('../../services/contractAnalysis/auth');
const { createContractVersionSnapshot } = require('../../services/contractAnalysis/version');
const { escapeXmlText, replaceTextInDocx } = require('../../services/contractAnalysis/docxEdit');
const { buildOnlyOfficeConfig } = require('../../services/contractAnalysis/onlyoffice');

const parseAnalysisResult = (contract) => {
    try {
        return typeof contract.analysis_result === 'string'
            ? JSON.parse(contract.analysis_result || '{}')
            : (contract.analysis_result || {});
    } catch {
        return {};
    }
};

const markSuggestionApplied = (analysis, indexes, mode, documentKey) => {
    const suggestions = Array.isArray(analysis.modification_suggestions)
        ? analysis.modification_suggestions
        : [];
    for (const index of indexes) {
        const item = suggestions[Number(index)];
        if (!item) continue;
        item.application_status = mode === 'review' ? 'pending_review' : 'applied';
        item.review_pending = mode === 'review';
        item.adopted = mode === 'edit';
        item.applied_at = new Date().toISOString();
        item.applied_document_key = documentKey;
    }
    return analysis;
};

const tempDocxPath = (storagePath) => `${storagePath}.${uuidv4()}.tmp`;

const assertCurrentDocumentKey = (contract, expectedDocumentKey) => {
    if (expectedDocumentKey && expectedDocumentKey !== contract.document_key) {
        const error = new Error('DOCUMENT_VERSION_STALE');
        error.status = 409;
        throw error;
    }
};

const docxErrorResponse = (res, error, fallback) => {
    const messages = {
        DOCX_EXACT_TEXT_NOT_FOUND: '未能在当前 DOCX 中唯一定位该条款。系统已取消本次修改，文档未发生变化。',
        DOCX_TEXT_MATCH_AMBIGUOUS: '文档中存在多个相同片段，无法安全确定修改位置。请先定位并缩短原文后重试。',
        DOCX_COMPLEX_PARAGRAPH_UNSUPPORTED: '目标条款已包含批注、修订或复杂域，无法安全自动改写，请在左侧文档中人工处理。',
        DOCUMENT_VERSION_STALE: '文档已被其他修改更新，请刷新后再采纳该建议。',
    };
    if (messages[error.message]) {
        return res.status(error.status || 409).json({ error: messages[error.message], code: error.message });
    }
    console.error(`[ERROR] ${fallback}:`, error);
    return res.status(500).json({ error: fallback });
};

const updateContractAfterApply = async (contract, nextKey, analysis, appliedIndexes, mode) => {
    const updatedAnalysis = markSuggestionApplied(analysis, appliedIndexes, mode, nextKey);
    await db('contracts').where({ id: contract.id }).update({
        document_key: nextKey,
        analysis_result: JSON.stringify(updatedAnalysis),
        updated_at: db.fn.now(),
    });
};

module.exports = function (router) {
    router.post('/:id/replace-text', async (req, res) => {
        const userId = requireRequestUserId(req, res);
        if (!userId) return;
        const {
            originalText, suggestedText, originalCandidates = [], mode: rawMode,
            expectedDocumentKey, suggestionIndex,
        } = req.body || {};
        if (!String(originalText || '').trim() || suggestedText === undefined || suggestedText === null) {
            return res.status(400).json({ error: 'originalText and suggestedText are required.' });
        }
        const mode = rawMode === 'review' ? 'review' : 'edit';
        let workingPath = '';

        try {
            const contract = await findOwnedContract(req.params.id, userId);
            if (!contract) return res.status(404).json({ error: 'Contract not found.' });
            assertCurrentDocumentKey(contract, expectedDocumentKey);
            const ext = path.extname(contract.storage_path).toLowerCase().replace('.', '');
            if (ext !== 'docx') {
                return res.status(400).json({
                    error: 'PDF 文件暂不支持原文直接改写，请使用 PDF 批注意见或审查报告导出。',
                    code: 'PDF_REPLACE_NOT_SUPPORTED',
                });
            }

            workingPath = tempDocxPath(contract.storage_path);
            fs.copyFileSync(contract.storage_path, workingPath);
            const result = replaceTextInDocx(workingPath, originalText, suggestedText, originalCandidates, { mode, author: 'AI审查' });
            const version = await createContractVersionSnapshot(contract, `${mode}-replace-text`);
            fs.renameSync(workingPath, contract.storage_path);
            workingPath = '';

            const nextKey = uuidv4();
            const indexes = Number.isInteger(Number(suggestionIndex)) ? [Number(suggestionIndex)] : [];
            await updateContractAfterApply(contract, nextKey, parseAnalysisResult(contract), indexes, mode);
            return res.json({
                ...result,
                version,
                applicationStatus: mode === 'review' ? 'pending_review' : 'applied',
                editorConfig: buildOnlyOfficeConfig({ ...contract, document_key: nextKey }, ext, { reviewMode: mode === 'review' }),
            });
        } catch (error) {
            if (workingPath && fs.existsSync(workingPath)) fs.unlinkSync(workingPath);
            return docxErrorResponse(res, error, '服务端 DOCX 替换失败。');
        }
    });

    router.post('/:id/batch-replace-text', async (req, res) => {
        const userId = requireRequestUserId(req, res);
        if (!userId) return;
        const suggestions = Array.isArray(req.body?.suggestions) ? req.body.suggestions : [];
        if (!suggestions.length) return res.status(400).json({ error: '请至少选择一条修改建议。' });
        const mode = req.body?.mode === 'review' ? 'review' : 'edit';
        let workingPath = '';

        try {
            const contract = await findOwnedContract(req.params.id, userId);
            if (!contract) return res.status(404).json({ error: 'Contract not found.' });
            assertCurrentDocumentKey(contract, req.body?.expectedDocumentKey);
            const ext = path.extname(contract.storage_path).toLowerCase().replace('.', '');
            if (ext !== 'docx') return res.status(400).json({ error: 'PDF 文件暂不支持原文直接改写。', code: 'PDF_REPLACE_NOT_SUPPORTED' });

            workingPath = tempDocxPath(contract.storage_path);
            fs.copyFileSync(contract.storage_path, workingPath);
            const results = [];
            const appliedIndexes = [];
            let totalReplacements = 0;
            for (const [requestIndex, item] of suggestions.entries()) {
                const originalText = item.originalText || item.original_text || item.original_clause;
                const suggestedText = item.suggestedText ?? item.suggested_text ?? item.modification;
                if (!String(originalText || '').trim() || suggestedText === undefined || suggestedText === null) {
                    results.push({ index: requestIndex, suggestionIndex: item.suggestionIndex, ok: false, error: '缺少原文或建议修改文本。', title: item.title || '' });
                    continue;
                }
                try {
                    const result = replaceTextInDocx(
                        workingPath, originalText, suggestedText,
                        item.originalCandidates || item.original_candidates || [],
                        { mode, author: 'AI审查' },
                    );
                    totalReplacements += result.replacements;
                    if (Number.isInteger(Number(item.suggestionIndex))) appliedIndexes.push(Number(item.suggestionIndex));
                    results.push({ index: requestIndex, suggestionIndex: item.suggestionIndex, ok: true, ...result, title: item.title || '' });
                } catch (error) {
                    results.push({ index: requestIndex, suggestionIndex: item.suggestionIndex, ok: false, error: error.message, title: item.title || '' });
                }
            }

            const succeededCount = results.filter((item) => item.ok).length;
            const failedCount = results.length - succeededCount;
            if (!succeededCount) {
                fs.unlinkSync(workingPath);
                workingPath = '';
                return res.status(409).json({ error: '所选建议均未能安全定位，文档未发生变化。', results });
            }

            const version = await createContractVersionSnapshot(contract, `${mode}-batch-replace-text`);
            fs.renameSync(workingPath, contract.storage_path);
            workingPath = '';
            const nextKey = uuidv4();
            await updateContractAfterApply(contract, nextKey, parseAnalysisResult(contract), appliedIndexes, mode);
            return res.json({
                version, mode,
                applicationStatus: mode === 'review' ? 'pending_review' : 'applied',
                totalReplacements, succeededCount, failedCount, results,
                editorConfig: buildOnlyOfficeConfig({ ...contract, document_key: nextKey }, ext, { reviewMode: mode === 'review' }),
            });
        } catch (error) {
            if (workingPath && fs.existsSync(workingPath)) fs.unlinkSync(workingPath);
            return docxErrorResponse(res, error, '批量替换失败。');
        }
    });

    router.post('/:id/append-clause', async (req, res) => {
        const userId = requireRequestUserId(req, res);
        if (!userId) return;
        const { title, content, expectedDocumentKey, suggestionIndex } = req.body || {};
        if (!String(content || '').trim()) return res.status(400).json({ error: '追加条款内容不能为空。' });
        const mode = req.body?.mode === 'review' ? 'review' : 'edit';
        let workingPath = '';

        try {
            const contract = await findOwnedContract(req.params.id, userId);
            if (!contract) return res.status(404).json({ error: 'Contract not found.' });
            assertCurrentDocumentKey(contract, expectedDocumentKey);
            const ext = path.extname(contract.storage_path).toLowerCase().replace('.', '');
            if (ext !== 'docx') return res.status(400).json({ error: 'PDF 文件暂不支持追加条款。', code: 'PDF_APPEND_NOT_SUPPORTED' });

            workingPath = tempDocxPath(contract.storage_path);
            fs.copyFileSync(contract.storage_path, workingPath);
            const zip = new AdmZip(workingPath);
            const entry = zip.getEntry('word/document.xml');
            if (!entry) throw new Error('DOCX_DOCUMENT_XML_NOT_FOUND');
            let documentXml = entry.getData().toString('utf8');
            const normalizedContent = String(content).trim();
            if (documentXml.includes(escapeXmlText(normalizedContent))) {
                fs.unlinkSync(workingPath);
                workingPath = '';
                return res.json({ ok: true, alreadyPresent: true, message: `条款「${title || '未命名条款'}」已存在，未重复追加。`, editorConfig: buildOnlyOfficeConfig(contract, ext, { reviewMode: mode === 'review' }) });
            }

            let revisionId = Date.now() % 100000000;
            const wrap = (run) => {
                if (mode !== 'review') return run;
                revisionId += 1;
                return `<w:ins w:id="${revisionId}" w:author="AI审查" w:date="${new Date().toISOString()}">${run}</w:ins>`;
            };
            const titlePara = title
                ? `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${wrap(`<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXmlText(title)}</w:t></w:r>`)}</w:p>`
                : '';
            const contentParas = normalizedContent.split(/\n+/).map((line) =>
                `<w:p>${wrap(`<w:r><w:t xml:space="preserve">${escapeXmlText(line)}</w:t></w:r>`)}</w:p>`
            ).join('');
            const insertXml = `${titlePara}${contentParas}`;
            const sectionIndex = documentXml.lastIndexOf('<w:sectPr');
            if (sectionIndex >= 0) documentXml = `${documentXml.slice(0, sectionIndex)}${insertXml}${documentXml.slice(sectionIndex)}`;
            else if (documentXml.includes('</w:body>')) documentXml = documentXml.replace('</w:body>', `${insertXml}</w:body>`);
            else throw new Error('DOCX_BODY_NOT_FOUND');
            zip.updateFile('word/document.xml', Buffer.from(documentXml, 'utf8'));
            zip.writeZip(workingPath);

            const version = await createContractVersionSnapshot(contract, `${mode}-append-clause`);
            fs.renameSync(workingPath, contract.storage_path);
            workingPath = '';
            const nextKey = uuidv4();
            const indexes = Number.isInteger(Number(suggestionIndex)) ? [Number(suggestionIndex)] : [];
            await updateContractAfterApply(contract, nextKey, parseAnalysisResult(contract), indexes, mode);
            return res.json({
                ok: true, mode, version,
                applicationStatus: mode === 'review' ? 'pending_review' : 'applied',
                message: mode === 'review' ? `已将条款「${title || '未命名条款'}」加入审阅修订。` : `已追加条款「${title || '未命名条款'}」到文档末尾。`,
                editorConfig: buildOnlyOfficeConfig({ ...contract, document_key: nextKey }, ext, { reviewMode: mode === 'review' }),
            });
        } catch (error) {
            if (workingPath && fs.existsSync(workingPath)) fs.unlinkSync(workingPath);
            return docxErrorResponse(res, error, '追加条款失败。');
        }
    });
};
