/**
 * @file routes/contracts/textEditRoutes.js
 * @brief 合同 DOCX 文本替换与条款追加路由
 *
 * 核心职责：
 * - 单条文本替换（replace-text）
 * - 批量文本替换（batch-replace-text）
 * - 在文档末尾追加缺失条款（append-clause）
 *
 * 关键实现：
 * - 操作前创建版本快照
 * - 通过 adm-zip 直接修改 DOCX 的 word/document.xml
 * - 替换后更新 document_key 以刷新 OnlyOffice 编辑器
 * - PDF 文件不支持原文改写
 *
 * 依赖关系：
 * - 上游：database、adm-zip、uuid、services/contractAnalysis（auth、version、docxEdit、onlyoffice）
 * - 下游：被 routes/contracts/index.js 注册
 */
const db = require('../../database');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');
const { requireRequestUserId, findOwnedContract } = require('../../services/contractAnalysis/auth');
const { createContractVersionSnapshot } = require('../../services/contractAnalysis/version');
const { replaceTextInDocx } = require('../../services/contractAnalysis/docxEdit');
const { buildOnlyOfficeConfig } = require('../../services/contractAnalysis/onlyoffice');

module.exports = function (router) {
    router.post('/:id/replace-text', async (req, res) => {
        const userId = req.header('X-User-ID');
        const { originalText, suggestedText, originalCandidates = [] } = req.body || {};
        if (!originalText || !suggestedText) {
            return res.status(400).json({ error: 'originalText and suggestedText are required.' });
        }

        try {
            const query = db('contracts').where({ id: req.params.id });
            if (userId) query.andWhere({ user_id: userId });
            const contract = await query.first();
            if (!contract) return res.status(404).json({ error: 'Contract not found.' });

            const ext = path.extname(contract.storage_path).toLowerCase().replace('.', '');
            if (ext !== 'docx') {
                return res.status(400).json({
                    error: 'PDF 文件暂不支持原文直接改写，请使用 PDF 批注意见或审查报告导出。',
                    code: 'PDF_REPLACE_NOT_SUPPORTED',
                });
            }

            const version = await createContractVersionSnapshot(contract, 'replace-text');
            const replacements = replaceTextInDocx(contract.storage_path, originalText, suggestedText, originalCandidates);
            const nextKey = uuidv4();
            await db('contracts').where({ id: contract.id }).update({
                document_key: nextKey,
                updated_at: db.fn.now(),
            });
            const updatedContract = { ...contract, document_key: nextKey };
            res.json({
                replacements,
                version,
                editorConfig: buildOnlyOfficeConfig(updatedContract, ext),
            });
        } catch (error) {
            if (error.message === 'DOCX_EXACT_TEXT_NOT_FOUND') {
                return res.status(409).json({
                    error: '未能在 DOCX 源文件中精确匹配原文，请先定位原文或缩短替换片段后重试。',
                });
            }
            console.error('[ERROR] Server-side DOCX replacement failed:', error);
            res.status(500).json({ error: '服务端 DOCX 替换失败。' });
        }
    });

    router.post('/:id/batch-replace-text', async (req, res) => {
        const userId = requireRequestUserId(req, res);
        if (!userId) return;
        const suggestions = Array.isArray(req.body?.suggestions) ? req.body.suggestions : [];
        if (!suggestions.length) return res.status(400).json({ error: '请至少选择一条修改建议。' });

        try {
            const contract = await findOwnedContract(req.params.id, userId);
            if (!contract) return res.status(404).json({ error: 'Contract not found.' });

            const ext = path.extname(contract.storage_path).toLowerCase().replace('.', '');
            if (ext !== 'docx') {
                return res.status(400).json({
                    error: 'PDF 文件暂不支持原文直接改写，请下载 PDF 批注意见。',
                    code: 'PDF_REPLACE_NOT_SUPPORTED',
                });
            }

            const version = await createContractVersionSnapshot(contract, 'batch-replace-text');
            const results = [];
            let totalReplacements = 0;
            let succeededCount = 0;
            let failedCount = 0;

            for (const [index, item] of suggestions.entries()) {
                const originalText = item.originalText || item.original_text || item.original_clause;
                const suggestedText = item.suggestedText || item.suggested_text || item.modification;
                if (!originalText || !suggestedText) {
                    failedCount += 1;
                    results.push({ index, ok: false, error: '缺少原文或建议修改文本。', title: item.title || '' });
                    continue;
                }
                try {
                    const replacements = replaceTextInDocx(
                        contract.storage_path,
                        originalText,
                        suggestedText,
                        item.originalCandidates || item.original_candidates || [],
                    );
                    totalReplacements += replacements;
                    succeededCount += 1;
                    results.push({ index, ok: true, replacements, title: item.title || '' });
                } catch (error) {
                    failedCount += 1;
                    results.push({ index, ok: false, error: error.message, title: item.title || '' });
                }
            }

            const nextKey = uuidv4();
            await db('contracts').where({ id: contract.id }).update({
                document_key: nextKey,
                updated_at: db.fn.now(),
            });

            res.json({
                version,
                totalReplacements,
                succeededCount,
                failedCount,
                results,
                editorConfig: buildOnlyOfficeConfig({ ...contract, document_key: nextKey }, ext),
            });
        } catch (error) {
            console.error('[ERROR] Batch DOCX replacement failed:', error);
            res.status(500).json({ error: '批量替换失败。' });
        }
    });

    // 追加缺失条款到 DOCX 文档末尾（issue 3.4）
    router.post('/:id/append-clause', async (req, res) => {
        const userId = requireRequestUserId(req, res);
        if (!userId) return;
        const { title, content } = req.body || {};
        if (!content || !String(content).trim()) {
            return res.status(400).json({ error: '追加条款内容不能为空。' });
        }

        try {
            const contract = await findOwnedContract(req.params.id, userId);
            if (!contract) return res.status(404).json({ error: 'Contract not found.' });

            const ext = path.extname(contract.storage_path).toLowerCase().replace('.', '');
            if (ext !== 'docx') {
                return res.status(400).json({
                    error: 'PDF 文件暂不支持追加条款，请手动添加或导出审查报告。',
                    code: 'PDF_APPEND_NOT_SUPPORTED',
                });
            }

            // 创建版本快照
            const version = await createContractVersionSnapshot(contract, 'append-clause');

            // 使用 adm-zip 修改 DOCX，在 document.xml 末尾追加段落
            const zip = new AdmZip(contract.storage_path);
            const documentXmlEntry = zip.getEntry('word/document.xml');
            if (!documentXmlEntry) {
                return res.status(500).json({ error: 'DOCX 文件结构异常，无法找到 document.xml。' });
            }
            let documentXml = documentXmlEntry.getData().toString('utf8');
            const escapeXml = (text) => String(text || '')
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

            // 构建追加的段落 XML
            const titlePara = title
                ? `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(title)}</w:t></w:r></w:p>`
                : '';
            const contentParas = String(content).split(/\n+/).map((line) =>
                `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`
            ).join('');
            const insertXml = `${titlePara}${contentParas}`;

            // Word 要求 body 级 sectPr 保持为最后一个子节点；存在时必须插在它之前。
            const finalSectionIndex = documentXml.lastIndexOf('<w:sectPr');
            if (finalSectionIndex >= 0) {
                documentXml = `${documentXml.slice(0, finalSectionIndex)}${insertXml}${documentXml.slice(finalSectionIndex)}`;
            } else if (documentXml.includes('</w:body>')) {
                documentXml = documentXml.replace('</w:body>', `${insertXml}</w:body>`);
            } else {
                return res.status(500).json({ error: 'DOCX 文件结构异常，无法定位条款插入位置。' });
            }
            zip.updateFile('word/document.xml', Buffer.from(documentXml, 'utf8'));
            zip.writeZip(contract.storage_path);

            const nextKey = uuidv4();
            await db('contracts').where({ id: contract.id }).update({
                document_key: nextKey,
                updated_at: db.fn.now(),
            });

            res.json({
                ok: true,
                version,
                message: `已追加条款「${title || '未命名条款'}」到文档末尾。`,
                editorConfig: buildOnlyOfficeConfig({ ...contract, document_key: nextKey }, ext),
            });
        } catch (error) {
            console.error('[ERROR] Append clause failed:', error);
            res.status(500).json({ error: '追加条款失败。' });
        }
    });
};
