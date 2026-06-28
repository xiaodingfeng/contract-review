// Review.vue 分析启动/重审/状态轮询
import { ElMessage } from 'element-plus';
import api from '../api';

export function useReviewAnalysis(state) {
    const {
        contract, loading, loadingMessage, perspective, activeStep,
        preAnalysisData, selectedTemplateId, selectedReviewPoints, customPurposes,
        allSuggestedReviewPoints, allPotentialParties, allSuggestedCorePurposes,
        analysisActive, analysisPercent, analysisEta, analysisElapsed,
        analysisProgress, analysisSteps, analysisJobId, clauseProgress,
        statusPollTimer, elapsedTimer, socket, reAnalyzing, reviewData,
    } = state;

    // 本地计时器：每秒递增已用时、递减预计剩余，避免 LLM 审查期间后端不推送时进度卡住
    // 后端推送 analysis-progress 时会校准 analysisElapsed/analysisEta，本地计时器只填充两次推送之间的空白
    const startElapsedTimer = () => {
        if (elapsedTimer.value) return;
        elapsedTimer.value = setInterval(() => {
            if (!analysisActive.value) return;
            analysisElapsed.value += 1;
            if (analysisEta.value > 0) analysisEta.value -= 1;
        }, 1000);
    };

    const stopElapsedTimer = () => {
        if (elapsedTimer.value) {
            clearInterval(elapsedTimer.value);
            elapsedTimer.value = null;
        }
    };

    const startStatusPolling = () => {
        if (statusPollTimer.value) return;
        statusPollTimer.value = setInterval(async () => {
            if (!contract.id) return;
            try {
                const res = await api.getAnalyzeStatus(contract.id);
                const data = res.data;
                if (typeof data.percent === 'number') analysisPercent.value = data.percent;
                if (Array.isArray(data.steps)) analysisSteps.value = data.steps;
                if (typeof data.elapsedSeconds === 'number') analysisElapsed.value = data.elapsedSeconds;
                if (data.status === 'completed' && data.result) {
                    Object.assign(reviewData, data.result);
                    analysisActive.value = false;
                    loading.value = false;
                    reAnalyzing.value = false;
                    activeStep.value = 2;
                    stopStatusPolling();
                    stopElapsedTimer();
                    ElMessage.success('审查完成。');
                } else if (data.status === 'failed') {
                    analysisActive.value = false;
                    loading.value = false;
                    reAnalyzing.value = false;
                    stopStatusPolling();
                    stopElapsedTimer();
                    ElMessage.error(data.error || '分析失败，请稍后重试');
                }
            } catch (err) {
                console.warn('[Status Poll] Failed to fetch analysis status:', err.message);
            }
        }, 3000);
    };

    const stopStatusPolling = () => {
        if (statusPollTimer.value) {
            clearInterval(statusPollTimer.value);
            statusPollTimer.value = null;
        }
    };

    const startAnalysis = async () => {
        if (!perspective.value) {
            ElMessage.warning('请输入您的审查立场。');
            return;
        }
        loading.value = true;
        analysisActive.value = true;
        analysisPercent.value = 0;
        analysisEta.value = 0;
        analysisElapsed.value = 0;
        analysisProgress.value = [];
        analysisSteps.value = [];
        clauseProgress.value = { reviewed: 0, total: 0, current_clause_id: '' };
        loadingMessage.value = 'AI 正在深度审查合同，请通过下方进度追踪实时查看状态...';
        startElapsedTimer();
        try {
            const analysisPayload = {
                contractId: contract.id,
                userPerspective: perspective.value,
                preAnalysisData: {
                    contract_type: preAnalysisData.contract_type,
                    potential_parties: allPotentialParties.value,
                    suggested_review_points: allSuggestedReviewPoints.value,
                    suggested_core_purposes: allSuggestedCorePurposes.value,
                    reviewPoints: selectedReviewPoints.value,
                    core_purposes: customPurposes.value.map(p => p.value).filter(p => p.trim() !== ''),
                    template_id: selectedTemplateId.value,
                },
            };
            const res = await api.analyzeContract(analysisPayload);
            analysisJobId.value = res.data.jobId;
            if (Array.isArray(res.data.steps)) {
                analysisSteps.value = res.data.steps.map((s) => ({ ...s, status: 'pending', message: '' }));
            }
            if (!socket.value || !socket.value.connected) {
                startStatusPolling();
            }
        } catch(err) {
            const errorMessage = err.response?.data?.error || '启动分析失败，请稍后重试';
            ElMessage.error(errorMessage);
            analysisActive.value = false;
            loading.value = false;
            stopElapsedTimer();
        }
    };

    const addPurpose = () => {
        customPurposes.value.push({ value: '' });
    };

    const removePurpose = (index) => {
        customPurposes.value.splice(index, 1);
    };

    const startReAnalysis = async () => {
        if (!perspective.value) {
            ElMessage.warning('请选择您的审查立场。');
            return;
        }
        reAnalyzing.value = true;
        loading.value = true;
        analysisActive.value = true;
        analysisPercent.value = 0;
        analysisEta.value = 0;
        analysisElapsed.value = 0;
        analysisProgress.value = [];
        analysisSteps.value = [];
        clauseProgress.value = { reviewed: 0, total: 0, current_clause_id: '' };
        loadingMessage.value = '正在重新审查合同，请通过进度追踪查看状态...';
        startElapsedTimer();
        try {
            const analysisPayload = {
                contractId: contract.id,
                userPerspective: perspective.value,
                preAnalysisData: {
                    contract_type: preAnalysisData.contract_type,
                    potential_parties: allPotentialParties.value,
                    suggested_review_points: allSuggestedReviewPoints.value,
                    suggested_core_purposes: allSuggestedCorePurposes.value,
                    reviewPoints: selectedReviewPoints.value,
                    core_purposes: customPurposes.value.map(p => p.value).filter(p => p.trim() !== ''),
                    template_id: selectedTemplateId.value,
                },
            };
            const res = await api.analyzeContract(analysisPayload);
            analysisJobId.value = res.data.jobId;
            if (Array.isArray(res.data.steps)) {
                analysisSteps.value = res.data.steps.map((s) => ({ ...s, status: 'pending', message: '' }));
            }
            if (!socket.value || !socket.value.connected) {
                startStatusPolling();
            }
        } catch(err) {
            const errorMessage = err.response?.data?.error || '重审失败，请稍后重试';
            ElMessage.error(errorMessage);
            reAnalyzing.value = false;
            loading.value = false;
            analysisActive.value = false;
            stopElapsedTimer();
        }
    };

    return {
        startStatusPolling, stopStatusPolling,
        startElapsedTimer, stopElapsedTimer,
        startAnalysis, addPurpose, removePurpose, startReAnalysis,
    };
}
