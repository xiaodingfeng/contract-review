import axios from 'axios';
import { getUserId } from './user'; // Assuming user.js is in the same src directory

const apiClient = axios.create({
    baseURL: (import.meta.env.VITE_APP_BACKEND_API_URL || 'http://localhost:3000') + '/api',
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

    reviewSelectedText(payload) {
        return apiClient.post('/contracts/review-text', payload);
    },

    replaceContractText(contractId, payload) {
        return apiClient.post(`/contracts/${contractId}/replace-text`, payload);
    },

    getFreshEditorConfig(contractId) {
        return apiClient.get(`/contracts/${contractId}/editor-config`);
    },

    forceSaveContract(contractId, payload = {}) {
        return apiClient.post(`/contracts/${contractId}/force-save`, payload);
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

    getQAHistory(sessionId) {
        return apiClient.get(`/qa/history/${sessionId}`);
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

    getReviewTemplates() {
        return apiClient.get('/templates');
    }
};
