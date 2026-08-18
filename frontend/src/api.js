import axios from 'axios';
import { getUserId } from './user'; // Assuming user.js is in the same src directory

const defaultBackendUrl = import.meta.env.PROD ? window.location.origin : 'http://localhost:3000';
const backendBaseUrl = (import.meta.env.VITE_APP_BACKEND_API_URL || defaultBackendUrl).replace(/\/$/, '');

const apiClient = axios.create({
    baseURL: `${backendBaseUrl}/api`,
    headers: {
        'Content-Type': 'application/json'
    }
});

// 使用拦截器，在每个请求中自动注入用户ID到请求头
apiClient.interceptors.request.use(config => {
    const userId = getUserId();
    if (userId) {
        config.headers['X-User-ID'] = userId;
    }
    return config;
}, error => {
    return Promise.reject(error);
});

export default {
    uploadContract(formData) {
        return apiClient.post('/contracts/upload', formData, {
            headers: {
                'Content-Type': 'multipart/form-data'
            }
        });
    },

    preAnalyzeContract(payload) {
        return apiClient.post('/contracts/pre-analyze', payload);
    },

    analyzeContract(payload) {
        // Payload now contains { contractId, contractType, userPerspective, reviewPoints, corePurposes }
        return apiClient.post('/contracts/analyze', payload);
    },

    getAnalyzeStatus(contractId) {
        return apiClient.get(`/contracts/analyze-status/${contractId}`);
    },

    reviewSelectedText(payload) {
        return apiClient.post('/contracts/review-text', payload);
    },

    getFocusedReviews(contractId) {
        return apiClient.get(`/contracts/${contractId}/focused-reviews`);
    },

    deleteFocusedReview(reviewId) {
        return apiClient.delete(`/contracts/focused-reviews/${reviewId}`);
    },

    replaceContractText(contractId, payload) {
        return apiClient.post(`/contracts/${contractId}/replace-text`, payload);
    },

    batchReplaceContractText(contractId, payload) {
        return apiClient.post(`/contracts/${contractId}/batch-replace-text`, payload);
    },

    getContractVersions(contractId) {
        return apiClient.get(`/contracts/${contractId}/versions`);
    },

    getContractDiff(contractId, params = {}) {
        return apiClient.get(`/contracts/${contractId}/diff`, { params });
    },

    exportReviewReport(contractId, format = 'html') {
        return apiClient.get(`/contracts/${contractId}/export-report`, {
            params: { format },
            responseType: 'blob'
        });
    },

    downloadPdfAnnotations(contractId) {
        return apiClient.get(`/contracts/${contractId}/pdf-annotations`, { responseType: 'blob' });
    },

    createContractGroup(payload) {
        return apiClient.post('/contracts/groups', payload);
    },

    analyzeContractGroup(groupId) {
        return apiClient.post(`/contracts/groups/${groupId}/analyze`);
    },

    getContractGroup(groupId) {
        return apiClient.get(`/contracts/groups/${groupId}`);
    },

    exportContractGroup(groupId, format = 'html') {
        return apiClient.get(`/contracts/groups/${groupId}/export`, {
            params: { format },
            responseType: 'blob'
        });
    },

    deleteContractGroup(groupId) {
        return apiClient.delete(`/contracts/groups/${groupId}`);
    },

    getFreshEditorConfig(contractId) {
        return apiClient.get(`/contracts/${contractId}/editor-config`);
    },

    forceSaveContract(contractId, payload = {}) {
        return apiClient.post(`/contracts/${contractId}/force-save`, payload);
    },

    // 3.1 条款级增量审查:对比当前合同与上一版本,仅审查变更条款
    reviewIncremental(contractId, payload = {}) {
        return apiClient.post(`/contracts/${contractId}/review-incremental`, payload);
    },

    // 4.1 谈判博弈模拟:对修改建议模拟对方立场反向论证
    simulateNegotiation(contractId, payload = {}) {
        return apiClient.post(`/contracts/${contractId}/simulate-negotiation`, payload);
    },

    // 4.3 行业标准条款库
    listStandards(params = {}) {
        return apiClient.get('/standards', { params });
    },
    createStandard(payload) {
        return apiClient.post('/standards', payload);
    },
    updateStandard(id, payload) {
        return apiClient.put(`/standards/${id}`, payload);
    },
    deleteStandard(id) {
        return apiClient.delete(`/standards/${id}`);
    },
    compareStandards(payload) {
        return apiClient.post('/standards/compare', payload);
    },

    getHistory() {
        return apiClient.get('/contracts/history');
    },

    identifyUser(payload) {
        return apiClient.post('/users/identify', payload);
    },

    // This function is now corrected to fetch history for the current user via headers
    // The userId parameter is kept for compatibility with the calling component but is no longer used in the URL.
    getUserHistory(userId) {
        console.log(`Fetching history for user ${userId} (via headers)`);
        return apiClient.get('/contracts'); // Corrected endpoint
    },

    getContractDetails(contractId) {
        // The interceptor will handle adding the user ID header
        return apiClient.get(`/contracts/${contractId}`);
    },

    deleteContract(contractId) {
        // The interceptor will handle adding the user ID header for any potential backend checks
        return apiClient.delete(`/contracts/${contractId}`);
    },

    getContractHistory() {
        return apiClient.get('/contracts');
    },

    getQAHistory(sessionId, contractId) {
        const params = {};
        if (contractId !== undefined && contractId !== null) {
            params.contractId = contractId;
        } else {
            // 未选择合同时，只查询未关联合同的历史记录
            params.contractId = 'none';
        }
        return apiClient.get(`/qa/history/${sessionId}`, { params });
    },

    askQA(data) {
        return apiClient.post('/qa/ask', data);
    },

    getQaStreamUrl() {
        return `${apiClient.defaults.baseURL}/qa/ask-stream`;
    },

    searchKnowledge(query = '', params = {}) {
        return apiClient.get('/knowledge/search', { params: { q: query, ...params } });
    },

    listKnowledge(params = {}) {
        return apiClient.get('/knowledge/list', { params });
    },

    importKnowledge(laws) {
        return apiClient.post('/knowledge/import', { laws });
    },

    batchImportKnowledge(formData) {
        return apiClient.post('/knowledge/batch-import', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
    },

    deleteKnowledge(payload) {
        return apiClient.delete('/knowledge', { data: payload });
    },

    deleteKnowledgeById(id) {
        return apiClient.delete(`/knowledge/${id}`);
    },

    downloadKnowledgeTemplate(type = 'law') {
        return apiClient.get('/knowledge/template', { params: { type }, responseType: 'blob' });
    },

    getVectorStatus() {
        return apiClient.get('/knowledge/vector-status');
    },

    getReviewTemplates() {
        return apiClient.get('/templates');
    }
};

export { apiClient };
