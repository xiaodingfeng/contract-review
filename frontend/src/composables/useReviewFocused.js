// Review.vue 专项审查：选中文本读取、提交、历史管理
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';

export function useReviewFocused(state, editor) {
    const {
        contract, perspective, preAnalysisData, selectedTemplateId,
        activeAiTab, focusedReviewText, focusedReviewQuestion,
        focusedReviewResult, focusedReviewLoading, selectedSuggestionPreview,
    } = state;
    const { executeEditorMethod, ensureEditorReady, replaceTextInEditorFinal } = editor;

    const focusedReviewHistory = ref([]);
    const focusedReviewHistoryLoading = ref(false);

    const prepareFocusedReviewFromSelection = async () => {
        activeAiTab.value = 'workspace';
        if (!ensureEditorReady()) return;

        try {
            const text = await executeEditorMethod('GetSelectedText', []);
            if (text && String(text).trim()) {
                focusedReviewText.value = String(text).trim();
                ElMessage.success('已读取左侧选中文本。');
            } else {
                ElMessage.info('未读取到选中文本，可在专项审查框中手动粘贴条款。');
            }
        } catch (error) {
            ElMessage.info('当前 OnlyOffice 版本未暴露选中文本接口，请手动粘贴条款进行专项审查。');
        }
    };

    const submitFocusedReview = async () => {
        if (!focusedReviewText.value.trim()) return;
        focusedReviewLoading.value = true;
        try {
            const response = await api.reviewSelectedText({
                text: focusedReviewText.value,
                question: focusedReviewQuestion.value,
                perspective: perspective.value,
                contractType: preAnalysisData.contract_type,
                templateId: selectedTemplateId.value,
                contractId: contract.id,
            });
            focusedReviewResult.value = response.data;
            if (contract.id) loadFocusedReviewHistory();
        } catch (error) {
            ElMessage.error(error.response?.data?.error || '专项审查失败，请稍后重试。');
        } finally {
            focusedReviewLoading.value = false;
        }
    };

    const loadFocusedReviewHistory = async () => {
        if (!contract.id) return;
        focusedReviewHistoryLoading.value = true;
        try {
            const response = await api.getFocusedReviews(contract.id);
            focusedReviewHistory.value = response.data.items || [];
        } catch (error) {
            console.warn('Failed to load focused review history:', error);
        } finally {
            focusedReviewHistoryLoading.value = false;
        }
    };

    const loadFocusedReviewFromHistory = (item) => {
        focusedReviewText.value = item.source_text || '';
        focusedReviewQuestion.value = item.question || '';
        focusedReviewResult.value = item.result || null;
        ElMessage.success('已加载历史专项审查记录。');
    };

    const deleteFocusedReviewFromHistory = async (reviewId) => {
        try {
            await api.deleteFocusedReview(reviewId);
            focusedReviewHistory.value = focusedReviewHistory.value.filter((i) => i.id !== reviewId);
            ElMessage.success('已删除该条历史记录。');
        } catch (error) {
            ElMessage.error(error.response?.data?.error || '删除失败，请稍后重试。');
        }
    };

    const formatHistoryTime = (timeStr) => {
        if (!timeStr) return '';
        try {
            const d = new Date(timeStr);
            const pad = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } catch {
            return timeStr;
        }
    };

    const applyFocusedSuggestion = () => {
        if (!focusedReviewResult.value?.suggested_text) return;
        replaceTextInEditorFinal(focusedReviewText.value, focusedReviewResult.value.suggested_text, () => {
            selectedSuggestionPreview.value = {
                before: focusedReviewText.value,
                after: focusedReviewResult.value.suggested_text,
                status: '专项审查建议已替换到左侧文档',
            };
            focusedReviewText.value = focusedReviewResult.value.suggested_text;
            ElMessage.success('专项审查建议已更新到左侧文档。');
        }, (status) => {
            selectedSuggestionPreview.value = {
                before: focusedReviewText.value,
                after: focusedReviewResult.value.suggested_text,
                status,
            };
        });
    };

    return {
        focusedReviewHistory, focusedReviewHistoryLoading,
        prepareFocusedReviewFromSelection, submitFocusedReview,
        loadFocusedReviewHistory, loadFocusedReviewFromHistory,
        deleteFocusedReviewFromHistory, formatHistoryTime, applyFocusedSuggestion,
    };
}
