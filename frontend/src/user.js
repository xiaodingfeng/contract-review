import FingerprintJS from '@fingerprintjs/fingerprintjs';
import api from './api';

const USER_ID_KEY = 'user_id';

let currentUserId = localStorage.getItem(USER_ID_KEY);

/**
 * Identifies the current user using a browser fingerprint.
 * If a user ID is already in localStorage, it's considered valid.
 * Otherwise, it generates a fingerprint, sends it to the backend to get a user ID,
 * and then stores that ID in localStorage.
 * This ensures we only run the identification process once per session/browser.
 */
export const identifyUser = async () => {
    if (currentUserId) {
        console.log(`[User] Found existing User ID: ${currentUserId}`);
        return parseInt(currentUserId, 10);
    }

    console.log('[User] No User ID found. Identifying browser...');
    try {
        const fp = await FingerprintJS.load();
        const result = await fp.get();
        const visitorId = result.visitorId;

        console.log(`[User] Browser fingerprint generated: ${visitorId}`);

        const response = await api.identifyUser({ fingerprintId: visitorId });
        
        currentUserId = response.data.userId;
        localStorage.setItem(USER_ID_KEY, currentUserId);
        
        console.log(`[User] Successfully identified. User ID: ${currentUserId}`);
        
        return currentUserId;
    } catch (error) {
        console.error('[User] Fingerprinting or API identification failed:', error);
        // In a real app, you might want to handle this more gracefully.
        // For now, we'll block the user from proceeding without an ID.
        alert('无法识别用户身份，应用无法继续。请检查网络连接或浏览器设置。');
        return null;
    }
};

/**
 * Gets the current user's ID.
 * @returns {number|null} The current user's ID, or null if not identified.
 */
export const getUserId = () => {
    return currentUserId ? parseInt(currentUserId, 10) : null;
}; 