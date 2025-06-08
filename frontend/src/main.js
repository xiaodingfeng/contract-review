import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import { identifyUser } from './user'; // Import the user identification function

// Asynchronously identify the user first, then mount the app
identifyUser().then(userId => {
    if (userId) {
        // Create and mount the Vue app only after a user has been successfully identified.
        const app = createApp(App);

        app.use(router);
        app.use(ElementPlus);

        app.mount('#app');
    }
}).catch(error => {
    console.error("Application startup failed due to user identification error:", error);
    // You could render a fallback message to the user here if needed.
    document.getElementById('app').innerHTML = '<h2>应用启动失败</h2><p>无法验证用户身份，请刷新页面或联系管理员。</p>';
}); 