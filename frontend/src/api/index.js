import axios from 'axios';

const apiClient = axios.create({
    baseURL: 'http://localhost:3000/api',
    headers: {
        'Content-Type': 'application/json'
    }
});

export default {
    // Contract APIs
    getContractHistory() {
        return apiClient.get('/contracts');
    },
    getContractDetails(id) {
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