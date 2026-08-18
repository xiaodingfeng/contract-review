// Review.vue OnlyOffice 编辑器操作：搜索/替换/高亮/保存
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';

export function useReviewEditor(state, helpers) {
    const { contract, isEditorReady, selectedSuggestionPreview, docEditorComponent } = state;
    const { suggestionOriginal, suggestionText } = helpers;

    const forceSaveTimer = ref(null);
    const forceSaveDebounceTimer = ref(null);
    const forceSaveInFlight = ref(false);
    const hasPendingEditorChanges = ref(false);

    const getEditor = () => window?.DocEditor?.instances?.docEditorComponent || null;

    // ONLYOFFICE Community does not expose the paid Automation API connector on
    // the host DocEditor instance. The editor is proxied on the same origin in
    // this POC, so the document frame's plugin-compatible methods are available
    // as a fallback for search, comments, selected text and format-safe replace.
    const getCommunityEditor = () => {
        try {
            const frameWindow = document.querySelector('iframe[name="frameEditor"]')?.contentWindow;
            return frameWindow?.editor || frameWindow?.Asc?.editor || null;
        } catch {
            return null;
        }
    };

    const executeCommunityEditorMethod = (method, args = []) => {
        const editor = getCommunityEditor();
        if (!editor) throw new Error('EDITOR_NOT_READY');

        if (method === 'Search' && typeof editor.pluginMethod_SearchNext === 'function') {
            const text = String(args[0] || '').trim();
            if (!text) return [];
            const found = editor.pluginMethod_SearchNext({ searchString: text, matchCase: false }, true);
            return found ? [{ __communitySelection: true, text }] : [];
        }

        if (method === 'SelectRange' && args[0]?.__communitySelection) {
            // SearchNext already selects and scrolls the matching text.
            return true;
        }

        if (method === 'GetSelectedText' && typeof editor.pluginMethod_GetSelectedText === 'function') {
            return editor.pluginMethod_GetSelectedText({ Numbering: true, ParaSeparator: '\n' });
        }

        if (method === 'AddComment' && typeof editor.pluginMethod_AddComment === 'function') {
            const commentText = String(args[0] || 'AI 审查建议');
            const author = String(args[1] || 'AI 审查专家');
            return editor.pluginMethod_AddComment({
                Text: commentText,
                UserName: author,
                Time: String(Date.now()),
                Solved: false,
            });
        }

        if ((method === 'PasteText' || method === 'ReplaceText')
            && typeof editor.pluginMethod_ReplaceTextSmart === 'function') {
            const replacement = String(method === 'ReplaceText' ? args[1] : args[0] || '');
            const result = editor.pluginMethod_ReplaceTextSmart(
                replacement.split(/\r?\n/),
                '\t',
                '\r\n',
            );
            if (result === false) throw new Error('EDITOR_SMART_REPLACE_FAILED');
            return new Promise((resolve) => setTimeout(() => resolve(result), 450));
        }

        throw new Error(`EDITOR_METHOD_UNAVAILABLE:${method}`);
    };

    const executeEditorMethod = (method, args = []) => {
        const editor = getEditor();
        if (!editor || typeof editor.executeMethod !== 'function') {
            try {
                return Promise.resolve(executeCommunityEditorMethod(method, args));
            } catch (error) {
                return Promise.reject(error);
            }
        }
        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                resolve(null);
            }, 2500);
            try {
                editor.executeMethod(method, args, (result) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    resolve(result);
                });
            } catch (error) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(error);
            }
        });
    };

    const findTextRange = async (text) => {
        const result = await executeEditorMethod('Search', [text]);
        if (Array.isArray(result) && result.length > 0) return result[0];
        return null;
    };

    const normalizeCandidate = (text) => String(text || '')
        .replace(/[""]/g, '"')
        .replace(/['']/g, "'")
        .replace(/\s+/g, '')
        .trim();

    const splitCandidateSentences = (text) => String(text || '')
        .split(/(?<=[。！？；;.!?])|\n+/g)
        .map((item) => item.trim())
        .filter((item) => item.length >= 6);

    const buildSuggestionCandidates = (originalText, item = {}) => {
        const candidates = [
            originalText,
            item.anchor_hint,
            item.original_clause,
            item.clause,
            ...splitCandidateSentences(originalText),
        ];
        const compact = normalizeCandidate(originalText);
        if (compact && compact !== originalText) candidates.push(compact);
        if (originalText && originalText.length > 80) {
            candidates.push(originalText.slice(0, 80));
            candidates.push(originalText.slice(-80));
        }
        const seen = new Set();
        return candidates
            .map((candidate) => String(candidate || '').trim())
            .filter((candidate) => candidate.length >= 4)
            .filter((candidate) => {
                const key = normalizeCandidate(candidate);
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    };

    const buildReplacementCandidates = (originalText, item = {}) => {
        const candidates = [
            originalText,
            item.original_text,
            item.original_clause,
            item.current_clause,
            item.contract_clause,
        ];
        const seen = new Set();
        return candidates
            .map((candidate) => String(candidate || '').trim())
            .filter((candidate) => normalizeCandidate(candidate).length >= 8)
            .filter((candidate) => {
                const key = normalizeCandidate(candidate);
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    };

    const findTextRangeByCandidates = async (candidates) => {
        for (const candidate of candidates) {
            const range = await findTextRange(candidate);
            if (range) return { range, matchedText: candidate };
        }
        return null;
    };

    const ensureEditorReady = () => {
        if (!getEditor() && !getCommunityEditor()) {
            ElMessage.warning('编辑器尚未就绪，请等待左侧文档加载完成。');
            return false;
        }
        return true;
    };

    const previewSuggestion = (item, status = '待采纳') => {
        item._showPreview = status === '待采纳' ? !item._showPreview : true;
        if (!item._showPreview) return;
        selectedSuggestionPreview.value = {
            before: suggestionOriginal(item) || 'AI 未返回可直接定位的原文。',
            after: suggestionText(item) || 'AI 未返回建议替换文本。',
            status,
        };
    };

    const locateText = async (text, item = {}) => {
        if (!text) {
            ElMessage.info('AI 未返回可定位的原文，请在文档中手动核对该建议。');
            return;
        }
        if (!ensureEditorReady()) return;
        try {
            const matched = await findTextRangeByCandidates(buildSuggestionCandidates(text, item));
            if (!matched?.range) {
                ElMessage.info('未在文档中找到对应条款原文。');
                return;
            }
            await executeEditorMethod('SelectRange', [matched.range]);
            ElMessage.success('已定位到文档中的对应条款。');
        } catch (error) {
            ElMessage.error('文档定位失败，请检查 OnlyOffice 是否已完全加载。');
        }
    };

    const replaceTextOnServer = async (originalText, suggestedText, item = {}) => {
        const response = await api.replaceContractText(contract.id, {
            originalText,
            suggestedText,
            originalCandidates: buildReplacementCandidates(originalText, item),
        });
        return response.data.replacements || 0;
    };

    const markAdoptedText = async (originalText, suggestedText) => {
        try {
            const replacement = await findTextRangeByCandidates([suggestedText, suggestedText.slice(0, 80), suggestedText.slice(-80)]);
            if (!replacement?.range) return;
            await executeEditorMethod('SelectRange', [replacement.range]);
            const highlightMethods = [
                ['SetHighlightColor', ['#FFF2A8']],
                ['SetTextHighlightColor', ['#FFF2A8']],
                ['SetHighlight', ['#FFF2A8']],
            ];
            for (const [method, args] of highlightMethods) {
                try {
                    await executeEditorMethod(method, args);
                    break;
                } catch {
                    // Try the next OnlyOffice build-specific method name.
                }
            }
            await executeEditorMethod('AddComment', [`采纳前原文：${originalText}`, 'AI 审查']).catch(() => null);
        } catch {
            // Highlight/comment support depends on the deployed OnlyOffice build.
        }
    };

    const replaceTextInEditor = async (originalText, suggestedText, onSuccess, onFailure, item = {}) => {
        const runServerFallback = async (statusPrefix = 'OnlyOffice 未开放当前编辑方法，已更新源文件') => {
            try {
                const replacements = await replaceTextOnServer(originalText, suggestedText, item);
                onSuccess?.({ fallback: true, replacements });
                ElMessage.success(`${statusPrefix}；当前编辑器不刷新，重新打开该合同后可见。`);
            } catch (serverError) {
                const message = serverError.response?.data?.error || '服务器替换失败，请缩短原文片段后重试。';
                ElMessage.error(message);
                onFailure?.(message);
            }
        };

        if (!ensureEditorReady()) {
            onFailure?.('编辑器尚未就绪，请稍候');
            return;
        }
        try {
            const matched = await findTextRangeByCandidates(buildReplacementCandidates(originalText, item));
            if (!matched?.range) {
                await runServerFallback('编辑器未匹配到原文，已尝试从 DOCX 源文件替换');
                return;
            }
            await executeEditorMethod('SelectRange', [matched.range]);
            try {
                await executeEditorMethod('PasteText', [suggestedText]);
            } catch {
                await executeEditorMethod('ReplaceText', [matched.range, suggestedText]);
            }
            await markAdoptedText(originalText, suggestedText);
            onSuccess?.();
        } catch (error) {
            await runServerFallback();
        }
    };

    const refreshEditorDocument = async () => {
        const editor = getEditor();
        if (!editor) return false;

        try {
            const res = await api.getFreshEditorConfig(contract.id);
            const editorConfig = res.data?.editorConfig;
            if (editorConfig && typeof editor.refreshFile === 'function') {
                editor.refreshFile(editorConfig.document || editorConfig);
                contract.editorConfig = editorConfig;
                return true;
            }
            if (editorConfig && typeof editor.setConfig === 'function') {
                editor.setConfig(editorConfig);
                contract.editorConfig = editorConfig;
                return true;
            }
        } catch {
            // Some OnlyOffice builds do not allow changing config after init.
        }

        try {
            await executeEditorMethod('ForceSave', []);
            return true;
        } catch {
            return false;
        }
    };

    const serverFallback = async (originalText, suggestedText, onSuccess, onFailure, item = {}) => {
        try {
            const replacements = await replaceTextOnServer(originalText, suggestedText, item);
            const refreshed = await refreshEditorDocument();
            if (refreshed) {
                onSuccess?.({ fallback: true, refreshed: true, replacements });
                ElMessage.success('已更新源文件并尝试自动刷新编辑器');
            } else {
                onSuccess?.({ fallback: true, replacements });
                ElMessage.success('已更新源文件，刷新页面后可查看变更');
            }
        } catch (err) {
            const msg = err.response?.data?.error || '替换失败';
            ElMessage.error(msg);
            onFailure?.(msg);
        }
    };

    const replaceTextInEditorFinal = async (originalText, suggestedText, onSuccess, onFailure, item = {}) => {
        if (!ensureEditorReady()) {
            await serverFallback(originalText, suggestedText, onSuccess, onFailure, item);
            return;
        }

        let success = false;
        const editor = getEditor();

        try {
            const canUseLiveApi = typeof editor?.executeMethod === 'function'
                || typeof editor?.createConnector === 'function'
                || Boolean(window.Asc?.plugin?.callCommand)
                || Boolean(getCommunityEditor());
            if (!canUseLiveApi) {
                await serverFallback(originalText, suggestedText, onSuccess, onFailure, item);
                return;
            }

            const matched = await findTextRangeByCandidates(buildReplacementCandidates(originalText, item));
            if (matched?.range) {
                await executeEditorMethod('SelectRange', [matched.range]);
            }

            if (matched?.range && typeof editor?.createConnector === 'function') {
                const connector = editor.createConnector();
                if (connector?.callCommand) {
                    const asc = window.Asc || (window.Asc = {});
                    asc.scope = asc.scope || {};
                    asc.scope.suggestedText = suggestedText;
                    await new Promise((resolve) => {
                        connector.callCommand(function() {
                            try {
                                const oDocument = Api.GetDocument();
                                const oRange = oDocument.GetRangeBySelect?.() || null;
                                if (oRange) oRange.Delete();
                                const oParagraph = Api.CreateParagraph();
                                oParagraph.AddText(Asc.scope.suggestedText);
                                oDocument.InsertContent([oParagraph], false, { KeepTextOnly: false });
                            } catch (e) {}
                        }, true);
                        setTimeout(resolve, 800);
                    });
                    success = true;
                }
            }

            if (!success && matched?.range && window.Asc?.plugin?.callCommand) {
                window.Asc.scope = window.Asc.scope || {};
                window.Asc.scope.suggestedText = suggestedText;
                await new Promise((resolve) => {
                    window.Asc.plugin.callCommand(function() {
                        try {
                            const oDocument = Api.GetDocument();
                            const oRange = oDocument.GetRangeBySelect?.() || null;
                            if (oRange) oRange.Delete();
                            const oParagraph = Api.CreateParagraph();
                            oParagraph.AddText(Asc.scope.suggestedText);
                            oDocument.InsertContent([oParagraph], false, { KeepTextOnly: false });
                        } catch (e) {}
                    }, true);
                    setTimeout(resolve, 800);
                });
                success = true;
            }

            if (!success && matched?.range) {
                await executeEditorMethod('SelectRange', [matched.range]);
                try {
                    await executeEditorMethod('PasteText', [suggestedText]);
                    success = true;
                } catch {}
                if (!success) {
                    try {
                        await executeEditorMethod('ReplaceText', [matched.range, suggestedText]);
                        success = true;
                    } catch {}
                }
            }

            if (success) {
                await markAdoptedText(originalText, suggestedText);
                scheduleForceSave(500);
                onSuccess?.({ realTime: true });
                ElMessage.success('建议已实时采纳并更新到文档');
                return;
            }
        } catch (error) {
            console.warn('实时替换失败，进入服务器兜底', error);
        }

        await serverFallback(originalText, suggestedText, onSuccess, onFailure, item);
    };

    const appendClauseInEditorFinal = async (title, content, onSuccess, onFailure) => {
        try {
            const response = await api.appendContractClause(contract.id, { title, content });
            if (response.data?.editorConfig) contract.editorConfig = response.data.editorConfig;
            const refreshed = await refreshEditorDocument();
            onSuccess?.({ appended: true, refreshed, ...response.data });
            ElMessage.success(refreshed
                ? '新增条款已写入合同，并已刷新左侧文档。'
                : '新增条款已写入合同，刷新页面后可查看。');
        } catch (err) {
            const msg = err.response?.data?.error || '新增条款失败。';
            ElMessage.error(msg);
            onFailure?.(msg);
        }
    };

    // --- Force save ---
    const forceSaveCurrentDocument = async (silent = true) => {
        if (!contract.id || forceSaveInFlight.value) return false;
        forceSaveInFlight.value = true;
        try {
            const editor = getEditor();
            if (typeof editor?.serviceCommand === 'function') {
                editor.serviceCommand('forcesave', {});
            }
            await api.forceSaveContract(contract.id, {
                documentKey: contract.editorConfig?.document?.key,
            });
            hasPendingEditorChanges.value = false;
            if (!silent) ElMessage.success('已触发文档保存同步');
            return true;
        } catch (error) {
            console.warn('[OnlyOffice] force-save failed', error.response?.data || error.message);
            if (!silent) ElMessage.warning(error.response?.data?.error || '触发文档保存同步失败');
            return false;
        } finally {
            forceSaveInFlight.value = false;
        }
    };

    const scheduleForceSave = (delay = 1200) => {
        if (!contract.id) return;
        if (forceSaveDebounceTimer.value) {
            clearTimeout(forceSaveDebounceTimer.value);
        }
        forceSaveDebounceTimer.value = setTimeout(() => {
            forceSaveDebounceTimer.value = null;
            forceSaveCurrentDocument(true);
        }, delay);
    };

    const stopAutoForceSave = () => {
        if (forceSaveTimer.value) {
            clearInterval(forceSaveTimer.value);
            forceSaveTimer.value = null;
        }
        if (forceSaveDebounceTimer.value) {
            clearTimeout(forceSaveDebounceTimer.value);
            forceSaveDebounceTimer.value = null;
        }
    };

    const startAutoForceSave = () => {
        stopAutoForceSave();
        forceSaveTimer.value = setInterval(() => {
            if (hasPendingEditorChanges.value) {
                forceSaveCurrentDocument(true);
            }
        }, 30000);
    };

    const onDocumentStateChange = (event) => {
        const changed = typeof event === 'boolean' ? event : Boolean(event?.data);
        hasPendingEditorChanges.value = changed;
        if (changed) {
            scheduleForceSave();
        }
    };

    const onDocumentReady = () => {
        console.log("[INFO] OnlyOffice document is ready.");
        setTimeout(() => {
            isEditorReady.value = Boolean(getEditor() || getCommunityEditor());
            if (isEditorReady.value) startAutoForceSave();
        }, 300);
    };

    return {
        forceSaveTimer, forceSaveDebounceTimer, forceSaveInFlight, hasPendingEditorChanges,
        getEditor, getCommunityEditor, executeEditorMethod, findTextRange, normalizeCandidate,
        splitCandidateSentences, buildSuggestionCandidates, buildReplacementCandidates, findTextRangeByCandidates,
        ensureEditorReady, previewSuggestion, locateText, replaceTextOnServer,
        markAdoptedText, replaceTextInEditor, refreshEditorDocument, serverFallback,
        replaceTextInEditorFinal, appendClauseInEditorFinal,
        forceSaveCurrentDocument, scheduleForceSave, stopAutoForceSave, startAutoForceSave,
        onDocumentStateChange, onDocumentReady,
    };
}
