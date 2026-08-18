// Review.vue 核心共享状态：所有被 resetState 触及的状态集中在此
// 其他 composable 接收本返回值作为参数，仅包含函数逻辑
import { ref, reactive, computed, toRaw, nextTick } from 'vue';

export function useReviewState({ isResetting }) {
    const activeStep = ref(0);
    const cameFromHistory = ref(false);
    const loading = ref(false);
    const loadingMessage = ref('');
    const sessionLoadFailed = ref(false);
    const perspective = ref('');
    const activeAiTab = ref('summary');
    const docEditorComponent = ref(null);
    const isEditorReady = ref(false);
    const reAnalyzing = ref(false);
    const showPlainLanguage = ref(false);
    const socket = ref(null);

    const analysisProgress = ref([]);
    const clauseProgress = ref({ reviewed: 0, total: 0, current_clause_id: '' });
    const analysisPercent = ref(0);
    const analysisEta = ref(0);
    const analysisElapsed = ref(0);
    const analysisJobId = ref(null);
    const analysisSteps = ref([]);
    const statusPollTimer = ref(null);
    const elapsedTimer = ref(null);
    const analysisActive = ref(false);

    const selectedSuggestionPreview = ref(null);
    const adoptedHighlights = ref({});

    const contractModifiedNotice = ref(null);
    const incrementalReviewLoading = ref(false);

    const viewLawDialogVisible = ref(false);
    const currentLawRef = ref(null);

    const focusedReviewText = ref('');
    const focusedReviewQuestion = ref('');
    const focusedReviewResult = ref(null);
    const focusedReviewLoading = ref(false);

    const severityFilter = ref('all');

    const reviewTemplates = ref([]);
    const selectedTemplateId = ref('');

    const allSuggestedReviewPoints = ref([]);
    const allPotentialParties = ref([]);
    const allSuggestedCorePurposes = ref([]);

    const initialContractState = {
        id: null,
        original_filename: '',
        editorConfig: null,
    };
    const contract = reactive({ ...initialContractState });

    const preAnalysisData = reactive({
        contract_type: '',
        potential_parties: [],
        suggested_review_points: [],
        suggested_core_purposes: [],
        template_id: '',
        template_name: '',
    });

    const showContractPreview = ref(false);

    const selectedReviewPoints = ref([]);
    const customPurposes = ref([{ value: '' }]);

    const reviewData = reactive({
        dispute_points: [],
        missing_clauses: [],
        party_review: [],
        modification_suggestions: [],
        breach_cost_analysis: [],
        seal_analysis: [],
        relevant_laws: [],
        incremental_reviews: [],
        standard_comparison: [],
    });

    const onlyOfficeUrl = import.meta.env.VITE_APP_ONLYOFFICE_URL || '/onlyoffice/';

    // --- Constants ---
    const progressStepLabels = {
        pre_analysis: '合同预分析',
        extract_text: '提取合同正文',
        knowledge_search: '检索法条与案例',
        company_search: '核验合同主体',
        llm_review: '生成审查结论',
        seal_analysis: '印章与签章核验',
        finalize: '保存审查结果',
        failed: '分析失败',
    };
    const progressStatusLabels = {
        running: '进行中',
        completed: '已完成',
        failed: '失败',
        pending: '等待中',
        reviewed: '已审查',
        pre_analyzed: '已预分析',
        processing: '处理中',
        queued: '排队中',
    };
    const severityOrder = { high: 0, '高': 0, medium: 1, '中': 1, low: 2, '低': 2 };
    const companyRiskOrder = { red: 0, yellow: 1, green: 2 };

    // --- Simple helpers ---
    const progressStepLabel = (step) => progressStepLabels[step] || step || '处理中';
    const progressStatusLabel = (status) => progressStatusLabels[status] || status || '处理中';
    const progressStatusClass = (status) => {
        if (status === 'completed' || status === 'reviewed' || status === 'pre_analyzed') return 'completed';
        if (status === 'failed') return 'failed';
        if (status === 'running') return 'running';
        return 'pending';
    };
    const formatDuration = (seconds) => {
        if (!seconds || seconds < 0) return '0秒';
        if (seconds < 60) return `${seconds}秒`;
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return s > 0 ? `${m}分${s}秒` : `${m}分`;
    };
    const normalizeSeverity = (s) => {
        const v = String(s || '').toLowerCase().trim();
        if (['high', '高', '严重', 'critical'].includes(v)) return 'high';
        if (['medium', '中', '一般', 'moderate'].includes(v)) return 'medium';
        if (['low', '低', '轻微', 'minor'].includes(v)) return 'low';
        return 'medium';
    };
    const severityLabel = (s) => {
        const n = normalizeSeverity(s);
        return { high: '高', medium: '中', low: '低' }[n];
    };
    const severityClass = (s) => {
        const n = normalizeSeverity(s);
        return {
            high: 'bg-red-100 text-red-700 border-red-300',
            medium: 'bg-amber-100 text-amber-700 border-amber-300',
            low: 'bg-blue-100 text-blue-700 border-blue-300',
        }[n];
    };
    const firstText = (...values) => values.find(value => typeof value === 'string' && value.trim()) || '';
    const joinLines = (...values) => values.filter(value => typeof value === 'string' && value.trim()).join('\n');
    const companyRiskLevel = (item) => {
        const lvl = item && item.risk_level;
        if (lvl === 'red' || lvl === 'yellow' || lvl === 'green') return lvl;
        return 'green';
    };

    // --- Computed ---
    const visibleAnalysisProgress = computed(() => analysisProgress.value.slice(-6));
    const isPdfContract = computed(() => {
        const name = String(contract.original_filename || '').toLowerCase();
        return name.endsWith('.pdf');
    });
    const contractPreviewText = computed(() => {
        const preview = preAnalysisData.text_stats?.preview;
        if (preview) return preview;
        return '暂无预览内容。';
    });
    const incrementalReviews = computed(() => reviewData.incremental_reviews || []);
    const sortedCompanyReview = computed(() => {
        const list = reviewData.company_review || [];
        return [...list].sort((a, b) => {
            const oa = companyRiskOrder[companyRiskLevel(a)] ?? 2;
            const ob = companyRiskOrder[companyRiskLevel(b)] ?? 2;
            return oa - ob;
        });
    });
    const filteredAndSortedDisputePoints = computed(() => {
        const list = reviewData.dispute_points || [];
        const filtered = severityFilter.value === 'all'
            ? list
            : list.filter((item) => normalizeSeverity(item.severity) === severityFilter.value);
        return [...filtered].sort((a, b) => {
            const sa = severityOrder[normalizeSeverity(a.severity)] ?? 1;
            const sb = severityOrder[normalizeSeverity(b.severity)] ?? 1;
            return sa - sb;
        });
    });
    const disputeSeverityStats = computed(() => {
        const list = reviewData.dispute_points || [];
        const stats = { high: 0, medium: 0, low: 0 };
        list.forEach((item) => { stats[normalizeSeverity(item.severity)] += 1; });
        return stats;
    });
    const riskDashboard = computed(() => {
        const disputes = reviewData.dispute_points || [];
        const missing = reviewData.missing_clauses || [];
        const breach = reviewData.breach_cost_analysis || [];
        const party = reviewData.party_review || [];
        const suggestions = reviewData.modification_suggestions || [];
        const stats = disputeSeverityStats.value;
        const total = disputes.length;
        let overallLevel = 'low';
        let overallLabel = '低';
        let overallClass = 'bg-green-100 text-green-700 border-green-300';
        if (stats.high > 0) {
            overallLevel = 'high';
            overallLabel = '高';
            overallClass = 'bg-red-100 text-red-700 border-red-300';
        } else if (stats.medium > 0) {
            overallLevel = 'medium';
            overallLabel = '中';
            overallClass = 'bg-amber-100 text-amber-700 border-amber-300';
        }
        return {
            total,
            stats,
            overallLevel,
            overallLabel,
            overallClass,
            moduleCounts: {
                disputes: total,
                missing: missing.length,
                breach: breach.length,
                party: party.length,
                suggestions: suggestions.length,
            },
        };
    });
    const hardViolations = computed(() => {
        return reviewData.hard_violations || reviewData.analysis_result?.hard_violations || [];
    });

    // --- saveState / resetState ---
    const saveState = () => {
        if (isResetting.value) return;
        const stateToSave = {
            activeStep: activeStep.value,
            contract: toRaw(contract),
            perspective: perspective.value,
            preAnalysisData: toRaw(preAnalysisData),
            selectedReviewPoints: selectedReviewPoints.value,
            customPurposes: customPurposes.value,
            reviewData: toRaw(reviewData),
            activeAiTab: activeAiTab.value,
            cameFromHistory: cameFromHistory.value,
            allSuggestedReviewPoints: allSuggestedReviewPoints.value,
            allPotentialParties: allPotentialParties.value,
            allSuggestedCorePurposes: allSuggestedCorePurposes.value,
            selectedTemplateId: selectedTemplateId.value,
        };
        if (stateToSave.contract && stateToSave.contract.id) {
            localStorage.setItem('review_session', JSON.stringify(stateToSave));
        }
    };

    const resetState = () => {
        isResetting.value = true;
        activeStep.value = 0;
        loading.value = false;
        loadingMessage.value = '';
        if (elapsedTimer.value) {
            clearInterval(elapsedTimer.value);
            elapsedTimer.value = null;
        }
        Object.assign(contract, initialContractState);
        perspective.value = '';
        Object.assign(reviewData, {
            dispute_points: [],
            missing_clauses: [],
            party_review: [],
            company_review: [],
            modification_suggestions: [],
            breach_cost_analysis: [],
            seal_analysis: [],
            relevant_laws: [],
            hard_violations: [],
            incremental_reviews: [],
            standard_comparison: [],
        });
        contractModifiedNotice.value = null;
        incrementalReviewLoading.value = false;
        viewLawDialogVisible.value = false;
        currentLawRef.value = null;
        isEditorReady.value = false;
        Object.assign(preAnalysisData, { contract_type: '', potential_parties: [], suggested_review_points: [], suggested_core_purposes: [], template_id: '', template_name: '' });
        selectedTemplateId.value = 'general';
        selectedReviewPoints.value = [];
        customPurposes.value = [{ value: '' }];
        allSuggestedReviewPoints.value = [];
        allPotentialParties.value = [];
        allSuggestedCorePurposes.value = [];
        selectedSuggestionPreview.value = null;
        focusedReviewText.value = '';
        focusedReviewQuestion.value = '';
        focusedReviewResult.value = null;
        focusedReviewLoading.value = false;
        localStorage.removeItem('review_session');
        nextTick(() => {
            isResetting.value = false;
        });
    };

    return {
        activeStep, cameFromHistory, loading, loadingMessage, sessionLoadFailed,
        perspective, activeAiTab, docEditorComponent, isEditorReady, reAnalyzing,
        showPlainLanguage, socket,
        analysisProgress, clauseProgress, analysisPercent, analysisEta, analysisElapsed,
        analysisJobId, analysisSteps, statusPollTimer, elapsedTimer, analysisActive,
        selectedSuggestionPreview, adoptedHighlights,
        contractModifiedNotice, incrementalReviewLoading,
        viewLawDialogVisible, currentLawRef,
        focusedReviewText, focusedReviewQuestion, focusedReviewResult, focusedReviewLoading,
        severityFilter,
        reviewTemplates, selectedTemplateId,
        allSuggestedReviewPoints, allPotentialParties, allSuggestedCorePurposes,
        contract, initialContractState, preAnalysisData, reviewData,
        showContractPreview, selectedReviewPoints, customPurposes,
        onlyOfficeUrl,
        progressStepLabels, progressStatusLabels, severityOrder, companyRiskOrder,
        progressStepLabel, progressStatusLabel, progressStatusClass, formatDuration,
        normalizeSeverity, severityLabel, severityClass,
        firstText, joinLines, companyRiskLevel,
        visibleAnalysisProgress, isPdfContract, contractPreviewText,
        incrementalReviews, sortedCompanyReview,
        filteredAndSortedDisputePoints, disputeSeverityStats, riskDashboard, hardViolations,
        saveState, resetState,
    };
}
