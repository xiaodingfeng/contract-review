import axios from 'axios';
import { getUserId } from '../user'; // 引入获取用户ID的函数

const apiClient = axios.create({
    baseURL: process.env.VUE_APP_BACKEND_API_URL || 'http://localhost:3000/api',
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
    // Contract APIs
    getContractHistory() {
        // 无需再手动传递userId，拦截器会自动处理
        return apiClient.get('/contracts');
    },
    getContractDetails(id) {
        // 无需再手动传递userId，拦截器会自动处理
        return apiClient.get(`/contracts/${id}`);
    },
    updateContract(id, data) {
        return apiClient.put(`/contracts/${id}`, data);
    },
    // Note: upload is handled directly by element-ui's upload component action, not here.
    analyzeContract(data) {
        // data: { contractId, userPerspective, text }
        return apiClient.post('/contracts/analyze', data);
    },
    extractPartiesFromText(data) {
        // data: { text }
        return apiClient.post('/contracts/extract-parties', data);
    },
    exportContract(id, data) {
        return apiClient.post(`/contracts/${id}/export`, data, {
            responseType: 'blob', // Important for file downloads
        });
    },

    // Q&A APIs
    getQaHistory() {
        return apiClient.get('/qa/history');
    },
    askQuestion(data) {
        // data: { question, sessionId }
        return apiClient.post('/qa/ask', data);
    }
}; 