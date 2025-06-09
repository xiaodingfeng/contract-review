import axios from 'axios';

const apiClient = axios.create({
    baseURL: process.env.VUE_APP_BACKEND_API_URL,
    headers: {
        'Content-Type': 'application/json'
    }
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

    getHistory() {
        return apiClient.get('/contracts/history');
    },

    identifyUser(payload) {
        return apiClient.post('/users/identify', payload);
    },

    getUserHistory(userId) {
        return apiClient.get(`/users/${userId}/history`);
    },

    getContractDetails(contractId) {
        return apiClient.get(`/contracts/${contractId}`);
    },

    deleteContract(contractId) {
        return apiClient.delete(`/contracts/${contractId}`);
    }
}; 