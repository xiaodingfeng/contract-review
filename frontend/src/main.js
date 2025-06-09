import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import './assets/css/tailwind.css';
import { identifyUser } from './user'; // Import the user identification function

// Asynchronously identify the user first, then mount the app
async function main() {
    try {
        await identifyUser();
        
        const app = createApp(App);
        
        app.use(router);
        app.use(ElementPlus);
        
        app.mount('#app');
        
    } catch (error) {
        console.error("Failed to initialize the application:", error);
        // Optionally, render a fallback UI
        document.body.innerHTML = '<div style="text-align: center; margin-top: 50px;"><h1>应用加载失败</h1><p>请检查网络连接或联系管理员。</p></div>';
    }
}

main();

window.ResizeObserver = class _NewResizeObserver extends ResizeObserver {
    constructor(callback) {
        super(() => window.requestAnimationFrame(() => callback.apply(this, arguments)));
    }
}