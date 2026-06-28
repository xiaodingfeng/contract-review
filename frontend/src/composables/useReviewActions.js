// Review.vue 采纳/批量/导出/差异对比
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';

export function useReviewActions(state, editor, helpers) {
    const {
        contract, reviewData, activeAiTab, adoptedHighlights,
        selectedSuggestionPreview,
    } = state;
    const {
        executeEditorMethod, ensureEditorReady, findTextRange,
        buildSuggestionCandidates, replaceTextInEditorFinal, previewSuggestion,
    } = editor;
    const { suggestionOriginal, suggestionText, suggestionTitle } = helpers;

    const selectedSuggestionIndexes = ref([]);
    const batchApplying = ref(false);
    const diffItems = ref([]);
    const diffLoading = ref(false);

    const addDocComment = async (text, comment) => {
        if (!text) {
            ElMessage.info('AI 未返回可批注定位的原文，请手动添加批注。');
            return;
        }
        if (!ensureEditorReady()) return;
        try {
            const range = await findTextRange(text);
            if (!range) {
                ElMessage.info('定位原文失败，无法添加批注。');
                return;
            }
            await executeEditorMethod('SelectRange', [range]);
            const bookmark = `ai_review_${Date.now()}`;
            await executeEditorMethod('AddBookmark', [bookmark]).catch(() => null);
            await executeEditorMethod('AddComment', [comment || 'AI 审查建议', 'AI 审查专家']).catch(async () => {
                await executeEditorMethod('AddComment', [comment || 'AI 审查建议']);
            });
            ElMessage.success('已在文档中添加批注，并尝试写入书签锚点。');
        } catch (error) {
            ElMessage.error('添加批注失败：当前 OnlyOffice 未开放批注接口。');
        }
    };

    const adoptSuggestion = (item) => {
        const originalText = suggestionOriginal(item);
        const suggestedText = suggestionText(item);

        if (!originalText || !suggestedText) {
            ElMessage.warning('该建议缺少可自动替换的原文或建议文本，请手动修改。');
            return;
        }

        previewSuggestion(item, '正在采纳');
        replaceTextInEditorFinal(originalText, suggestedText, (result = {}) => {
            item.adopted = true;
            item.adopted_original = originalText;
            adoptedHighlights.value[suggestionTitle(item, 0)] = originalText;
            if (result.fallback) {
                selectedSuggestionPreview.value.status = '已写入源文件，当前页面未刷新';
                ElMessage.success('建议已采纳，源文件已更新；当前页面未刷新。');
            } else {
                selectedSuggestionPreview.value.status = '已实时更新到左侧文档';
                ElMessage.success('建议已采纳，左侧文档已更新。');
            }
        }, (status) => {
            selectedSuggestionPreview.value.status = status;
        }, item);
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
            const suggestions = indexes.map((index) => {
                const item = reviewData.modification_suggestions[index];
                return {
                    originalText: suggestionOriginal(item),
                    suggestedText: suggestionText(item),
                    originalCandidates: buildSuggestionCandidates(suggestionOriginal(item), item),
                };
            });
            const response = await api.batchReplaceContractText(contract.id, { suggestions });
            if (response.data.editorConfig) contract.editorConfig = response.data.editorConfig;
            indexes.forEach((index) => {
                if (reviewData.modification_suggestions[index]) reviewData.modification_suggestions[index].adopted = true;
            });
            ElMessage.success(`批量采纳完成，成功替换 ${response.data.totalReplacements || 0} 处。`);
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
        addDocComment, adoptSuggestion, downloadBlob,
        applySelectedSuggestions, loadLatestDiff, exportReport, downloadPdfAnnotations,
    };
}
