// Review.vue 上传与导航：单文件上传、多合同关联分析、步骤导航
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';
import { getUserId } from '../user';

export function useReviewUpload(state, deps) {
    const {
        contract, loading, loadingMessage, activeStep, isEditorReady,
        preAnalysisData, selectedTemplateId, reviewTemplates,
        allSuggestedReviewPoints, allPotentialParties, allSuggestedCorePurposes,
        selectedReviewPoints, customPurposes,
    } = state;
    const { setupSocket, resetState } = deps;

    const linkedGroupFiles = ref([]);
    const linkedAnalysisLoading = ref(false);
    const linkedAnalysisResult = ref(null);
    const linkedAnalysisProgress = ref([]);
    const linkedFileInput = ref(null);

    const loadReviewTemplates = async () => {
        try {
            const response = await api.getReviewTemplates();
            const list = response.data.items || response.data || [];
            reviewTemplates.value = list;
            if (list.length) {
                const exists = list.some((t) => t.id === selectedTemplateId.value);
                if (!selectedTemplateId.value || !exists) {
                    selectedTemplateId.value = list[0].id;
                }
            } else {
                ElMessage.warning('审查模板列表为空,请联系管理员初始化模板数据。');
            }
        } catch (error) {
            console.error('Failed to load review templates:', error);
            ElMessage.error('审查模板加载失败,请检查后端服务是否正常。');
        }
    };

    const handleBeforeUpload = (file) => {
        const ext = file.name.split('.').pop().toLowerCase();
        const isValid = ['docx', 'pdf'].includes(ext);
        if (!isValid) {
            ElMessage.error('只能上传 DOCX 或 PDF 格式的文件！');
            return false;
        }
        const maxSize = 50 * 1024 * 1024;
        if (file.size > maxSize) {
            ElMessage.error('文件大小超过 50MB 限制，请压缩或拆分后上传。');
            return false;
        }
        loading.value = true;
        loadingMessage.value = '正在上传并为您准备编辑器...';
        return isValid;
    };

    const handleUploadSuccess = async (res) => {
        contract.id = res.contractId;
        contract.editorConfig = res.editorConfig;
        contract.original_filename = res.editorConfig.document.title;
        setupSocket(contract.id);

        loading.value = true;
        loadingMessage.value = 'AI正在进行初步分析，请稍候...';
        try {
            const preAnalysisRes = await api.preAnalyzeContract({ contractId: contract.id });
            Object.assign(preAnalysisData, preAnalysisRes.data);
            selectedTemplateId.value = preAnalysisData.template_id || selectedTemplateId.value || '';
            allSuggestedReviewPoints.value = [...preAnalysisData.suggested_review_points];
            allPotentialParties.value = [...preAnalysisData.potential_parties];
            allSuggestedCorePurposes.value = [...preAnalysisData.suggested_core_purposes];
            selectedReviewPoints.value = [...preAnalysisData.suggested_review_points];
            if (preAnalysisData.suggested_core_purposes && preAnalysisData.suggested_core_purposes.length > 0) {
                customPurposes.value = preAnalysisData.suggested_core_purposes.map(p => ({ value: p }));
            } else {
                customPurposes.value = [{ value: '示例：确保权利与义务对等' }];
            }
            activeStep.value = 1;
        } catch (err) {
            ElMessage.error(err.response?.data?.error || '预分析失败，请重试。');
            resetState();
        } finally {
            loading.value = false;
        }
    };

    const handleUploadError = () => {
        loading.value = false;
        ElMessage.error('上传失败，请检查后端服务是否正常。');
    };

    const validateContractFile = (file) => {
        const ext = file.name.split('.').pop().toLowerCase();
        return ['docx', 'pdf'].includes(ext);
    };

    const openLinkedFilePicker = () => {
        linkedFileInput.value?.click();
    };

    const setLinkedProgress = (key, status, message) => {
        const labels = {
            select: '选择文件',
            group: '创建分析记录',
            upload: '上传关联合同',
            analyze: 'AI 关联分析',
            save: '保存分析结果',
        };
        const existing = linkedAnalysisProgress.value.find(item => item.key === key);
        const payload = { key, label: labels[key] || key, status, message };
        if (existing) {
            Object.assign(existing, payload);
        } else {
            linkedAnalysisProgress.value.push(payload);
        }
    };

    const handleLinkedFilesChange = (event) => {
        const files = Array.from(event.target.files || []);
        // 重置 input.value，否则用户选同一组文件第二次不会触发 change
        event.target.value = '';
        const validFiles = files.filter(validateContractFile);
        if (validFiles.length !== files.length) {
            ElMessage.warning('已忽略非 DOCX / PDF 格式文件。');
        }
        if (!validFiles.length) return;
        // 追加而非替换：按 name+size 去重
        const existingKeys = new Set(linkedGroupFiles.value.map((f) => `${f.name}_${f.size}`));
        const newFiles = validFiles.filter((f) => {
            const key = `${f.name}_${f.size}`;
            if (existingKeys.has(key)) return false;
            existingKeys.add(key);
            return true;
        });
        if (newFiles.length < validFiles.length) {
            ElMessage.warning('已忽略重复选择的文件。');
        }
        if (!newFiles.length) return;
        linkedGroupFiles.value = [...linkedGroupFiles.value, ...newFiles];
        linkedAnalysisResult.value = null;
        linkedAnalysisProgress.value = [];
        setLinkedProgress('select', linkedGroupFiles.value.length >= 2 ? 'done' : 'running', `已选择 ${linkedGroupFiles.value.length} 份合同。`);
    };

    const removeLinkedFile = (index) => {
        if (linkedAnalysisLoading.value) return;
        linkedGroupFiles.value.splice(index, 1);
        if (!linkedGroupFiles.value.length) {
            linkedAnalysisResult.value = null;
            linkedAnalysisProgress.value = [];
        } else {
            setLinkedProgress('select', linkedGroupFiles.value.length >= 2 ? 'done' : 'running', `已选择 ${linkedGroupFiles.value.length} 份合同。`);
        }
    };

    // 用户手动切换审查模板时，同步刷新审查点和核心目的列表
    // 保留预分析时 LLM 针对合同生成的增量，剔除旧模板默认值，合并新模板默认值
    // 避免出现"用 A 模板规则 + B 模板审查点"的错配，也避免丢失 LLM 增量
    let lastTemplateId = null;
    const handleTemplateChange = (newTemplateId) => {
        if (!newTemplateId) return;
        const newTemplate = reviewTemplates.value.find((t) => t.id === newTemplateId);
        if (!newTemplate) return;
        // 旧模板 id：优先用 lastTemplateId（用户上一次切换后的值），fallback 到预分析推荐的模板
        const oldTemplateId = lastTemplateId || preAnalysisData.template_id || '';
        const newPoints = Array.isArray(newTemplate.review_points) ? [...newTemplate.review_points] : [];
        const newPurposes = Array.isArray(newTemplate.core_purposes) ? [...newTemplate.core_purposes] : [];
        if (oldTemplateId && oldTemplateId !== newTemplateId) {
            const oldTemplate = reviewTemplates.value.find((t) => t.id === oldTemplateId);
            const oldPointsSet = new Set(oldTemplate?.review_points || []);
            const oldPurposesSet = new Set(oldTemplate?.core_purposes || []);
            // 当前列表里不属于旧模板默认的部分 = LLM 针对合同的增量，保留
            const llmExtraPoints = allSuggestedReviewPoints.value.filter((p) => !oldPointsSet.has(p));
            const llmExtraPurposes = allSuggestedCorePurposes.value.filter((p) => !oldPurposesSet.has(p));
            // 新列表 = 新模板默认 + LLM 增量，去重
            allSuggestedReviewPoints.value = Array.from(new Set([...newPoints, ...llmExtraPoints]));
            selectedReviewPoints.value = [...allSuggestedReviewPoints.value];
            allSuggestedCorePurposes.value = Array.from(new Set([...newPurposes, ...llmExtraPurposes]));
            customPurposes.value = allSuggestedCorePurposes.value.length
                ? allSuggestedCorePurposes.value.map((p) => ({ value: p }))
                : [{ value: '' }];
        }
        lastTemplateId = newTemplateId;
    };

    const uploadContractToGroup = async (file, groupId, userId) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('userId', userId);
        formData.append('groupId', groupId);
        return api.uploadContract(formData);
    };

    const startLinkedContractAnalysis = async () => {
        const userId = getUserId();
        if (!userId) {
            ElMessage.error('无法获取用户身份，请刷新页面重试。');
            return;
        }
        if (linkedGroupFiles.value.length < 2) {
            ElMessage.warning('请至少选择 2 份合同文件。');
            return;
        }

        linkedAnalysisLoading.value = true;
        linkedAnalysisResult.value = null;
        try {
            setLinkedProgress('group', 'running', '正在创建关联合同分析记录。');
            const groupName = `关联合同组 ${new Date().toLocaleString('zh-CN')}`;
            const groupRes = await api.createContractGroup({ name: groupName });
            const groupId = groupRes.data.id;
            setLinkedProgress('group', 'done', '分析记录已创建。');
            setLinkedProgress('upload', 'running', '正在上传所选合同。');
            await Promise.all(linkedGroupFiles.value.map((file) => uploadContractToGroup(file, groupId, userId)));
            setLinkedProgress('upload', 'done', '合同上传完成。');
            setLinkedProgress('analyze', 'running', 'AI 正在识别条款冲突与共同风险。');
            const analysisRes = await api.analyzeContractGroup(groupId);
            linkedAnalysisResult.value = analysisRes.data.result || {};
            setLinkedProgress('analyze', 'done', '关联分析完成。');
            setLinkedProgress('save', 'done', '分析结果已保存，可在历史记录中查看。');
            ElMessage.success('多合同关联分析已完成。');
        } catch (error) {
            setLinkedProgress('analyze', 'failed', error.response?.data?.error || '多合同关联分析失败。');
            ElMessage.error(error.response?.data?.error || '多合同关联分析失败，请稍后重试。');
        } finally {
            linkedAnalysisLoading.value = false;
        }
    };

    const uploadAndGo = async (file) => {
        const formData = new FormData();
        formData.append('file', file);
        const userId = getUserId();
        if (!userId) {
            ElMessage.error("无法获取用户身份，请刷新页面重试。");
            loading.value = false;
            return;
        }
        formData.append('userId', userId);

        try {
            const res = await api.uploadContract(formData);
            handleUploadSuccess(res.data);
        } catch (err) {
            handleUploadError();
        }
    };

    const goBackToUpload = () => {
        console.log('[DEBUG] goBackToUpload clicked.');
        resetState();
    };

    const goBackToConfirm = () => {
        activeStep.value = 1;
        isEditorReady.value = false;
    };

    return {
        linkedGroupFiles, linkedAnalysisLoading, linkedAnalysisResult,
        linkedAnalysisProgress, linkedFileInput,
        loadReviewTemplates, handleBeforeUpload, handleUploadSuccess,
        handleUploadError, validateContractFile, openLinkedFilePicker,
        setLinkedProgress, handleLinkedFilesChange, removeLinkedFile, handleTemplateChange,
        uploadContractToGroup, startLinkedContractAnalysis, uploadAndGo, goBackToUpload, goBackToConfirm,
    };
}
