// Review.vue 采纳/批量/导出/差异对比
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';

export function useReviewActions(state, editor, helpers) {
    const {
        contract, reviewData, activeAiTab, adoptedHighlights,
        selectedSuggestionPreview, reviewApplyMode,
    } = state;
    const {
        executeEditorMethod, ensureEditorReady, findTextRangeByCandidates,
        buildSuggestionCandidates, buildReplacementCandidates, replaceTextInEditorFinal, previewSuggestion,
        appendClauseInEditorFinal, scheduleForceSave, forceSaveCurrentDocument,
    } = editor;
    const { suggestionOriginal, suggestionText, suggestionTitle, isMissingClauseSuggestion } = helpers;

    const selectedSuggestionIndexes = ref([]);
    const batchApplying = ref(false);
    const diffItems = ref([]);
    const diffLoading = ref(false);

    const addDocComment = async (text, comment, item = {}) => {
        if (!text) {
            ElMessage.info('AI 未返回可批注定位的原文，请手动添加批注。');
            return;
        }
        if (!ensureEditorReady()) return;
        try {
            const matched = await findTextRangeByCandidates(buildSuggestionCandidates(text, item));
            if (!matched?.range) {
                ElMessage.info('定位原文失败，无法添加批注。');
                return;
            }
            await executeEditorMethod('SelectRange', [matched.range]);
            const bookmark = `ai_review_${Date.now()}`;
            await executeEditorMethod('AddBookmark', [bookmark]).catch(() => null);
            await executeEditorMethod('AddComment', [comment || 'AI 审查建议', 'AI 审查专家']).catch(async () => {
                await executeEditorMethod('AddComment', [comment || 'AI 审查建议']);
            });
            scheduleForceSave(300);
            ElMessage.success('已在文档中添加批注并触发保存。');
        } catch (error) {
            ElMessage.error('添加批注失败：当前 OnlyOffice 未开放批注接口。');
        }
    };

    const isSuggestionApplied = (item) => item?.adopted || item?.application_status === 'pending_review';

    const applyResultToSuggestion = (item, originalText, suggestedText, result = {}) => {
        const pendingReview = result.applicationStatus === 'pending_review' || reviewApplyMode.value === 'review';
        item.application_status = pendingReview ? 'pending_review' : 'applied';
        item.review_pending = pendingReview;
        item.adopted = !pendingReview;
        item.adopted_original = originalText || '合同未约定';
        adoptedHighlights.value[suggestionTitle(item, 0)] = originalText || suggestedText;
        if (!selectedSuggestionPreview.value) {
            selectedSuggestionPreview.value = { before: originalText || '合同未约定', after: suggestedText, status: '' };
        }
        selectedSuggestionPreview.value.status = pendingReview
            ? '已加入审阅修订，可在左侧接受或拒绝'
            : '已直接写入左侧文档';
        ElMessage.success(pendingReview ? '已加入审阅修订。' : '建议已直接写入合同。');
    };

    const adoptSuggestion = async (item, suggestionIndex) => {
        const originalText = suggestionOriginal(item);
        const suggestedText = suggestionText(item);

        if (!suggestedText || (!originalText && !isMissingClauseSuggestion(item))) {
            ElMessage.warning('该建议缺少可写入合同的建议文本，请手动修改。');
            return;
        }

        const markAdopted = (result = {}) => applyResultToSuggestion(item, originalText, suggestedText, result);
        const markFailed = (status) => {
            selectedSuggestionPreview.value.status = status;
        };

        if (isMissingClauseSuggestion(item)) {
            previewSuggestion(item, '正在新增条款');
            await appendClauseInEditorFinal(
                suggestionTitle(item, 0),
                suggestedText,
                markAdopted,
                markFailed,
                { mode: reviewApplyMode.value, suggestionIndex },
            );
            return;
        }

        previewSuggestion(item, '正在采纳');
        await replaceTextInEditorFinal(originalText, suggestedText, markAdopted, markFailed, item, {
            mode: reviewApplyMode.value,
            suggestionIndex,
        });
    };

    const downloadBlob = (blob, filename) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    const applySelectedSuggestions = async () => {
        const indexes = selectedSuggestionIndexes.value;
        if (!indexes.length) {
            ElMessage.warning('请选择要批量采纳的修改建议。');
            return;
        }
        batchApplying.value = true;
        try {
            const selectedItems = indexes.map((index) => ({
                index,
                item: reviewData.modification_suggestions[index],
            })).filter(({ item }) => item && !isSuggestionApplied(item));
            const appendItems = selectedItems.filter(({ item }) => isMissingClauseSuggestion(item));
            const replacementItems = selectedItems.filter(({ item }) => !isMissingClauseSuggestion(item));
            let succeededCount = 0;
            let failedCount = 0;
            let totalReplacements = 0;

            if (replacementItems.length) {
                await forceSaveCurrentDocument(true);
                await new Promise((resolve) => setTimeout(resolve, 650));
                const suggestions = replacementItems.map(({ item, index }) => ({
                    suggestionIndex: index,
                    title: suggestionTitle(item, 0),
                    originalText: suggestionOriginal(item),
                    suggestedText: suggestionText(item),
                    originalCandidates: buildReplacementCandidates(suggestionOriginal(item), item),
                }));
                const response = await api.batchReplaceContractText(contract.id, {
                    suggestions,
                    mode: reviewApplyMode.value,
                    expectedDocumentKey: contract.editorConfig?.document?.key,
                });
                if (response.data.editorConfig) contract.editorConfig = response.data.editorConfig;
                totalReplacements += response.data.totalReplacements || 0;
                succeededCount += response.data.succeededCount || 0;
                failedCount += response.data.failedCount || 0;
                (response.data.results || []).forEach((result) => {
                    if (result.ok) {
                        const target = replacementItems[result.index].item;
                        applyResultToSuggestion(target, suggestionOriginal(target), suggestionText(target), response.data);
                    }
                });
            }

            for (const { item, index } of appendItems) {
                try {
                    await forceSaveCurrentDocument(true);
                    await new Promise((resolve) => setTimeout(resolve, 650));
                    const response = await api.appendContractClause(contract.id, {
                        title: suggestionTitle(item, 0),
                        content: suggestionText(item),
                        mode: reviewApplyMode.value,
                        suggestionIndex: index,
                        expectedDocumentKey: contract.editorConfig?.document?.key,
                    });
                    if (response.data.editorConfig) contract.editorConfig = response.data.editorConfig;
                    applyResultToSuggestion(item, suggestionOriginal(item), suggestionText(item), response.data);
                    succeededCount += 1;
                } catch {
                    failedCount += 1;
                }
            }

            if (!selectedItems.length) {
                ElMessage.info('所选建议均已处理。');
                return;
            }

            ElMessage.success(`批量处理完成：成功 ${succeededCount} 项${totalReplacements ? `，替换 ${totalReplacements} 处` : ''}${failedCount ? `，失败 ${failedCount} 项` : ''}。`);
            await loadLatestDiff();
        } catch (error) {
            ElMessage.error(error.response?.data?.error || '批量采纳失败。');
        } finally {
            batchApplying.value = false;
        }
    };

    const loadLatestDiff = async () => {
        if (!contract.id) return;
        diffLoading.value = true;
        try {
            const response = await api.getContractDiff(contract.id);
            diffItems.value = response.data.diff || [];
            activeAiTab.value = 'workspace';
        } catch (error) {
            ElMessage.info(error.response?.data?.error || '暂无可对比的合同版本。');
        } finally {
            diffLoading.value = false;
        }
    };

    const exportReport = async (format = 'html') => {
        try {
            const response = await api.exportReviewReport(contract.id, format);
            downloadBlob(response.data, `合同审查报告.${format === 'word' ? 'doc' : format}`);
        } catch (error) {
            ElMessage.error(error.response?.data?.error || '导出审查报告失败。');
        }
    };

    const downloadPdfAnnotations = async () => {
        try {
            const response = await api.downloadPdfAnnotations(contract.id);
            downloadBlob(response.data, 'PDF批注意见.txt');
        } catch (error) {
            ElMessage.error(error.response?.data?.error || '导出 PDF 批注意见失败。');
        }
    };

    return {
        selectedSuggestionIndexes, batchApplying, diffItems, diffLoading,
        addDocComment, adoptSuggestion, isSuggestionApplied, downloadBlob,
        applySelectedSuggestions, loadLatestDiff, exportReport, downloadPdfAnnotations,
    };
}
