import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import 'element-plus/dist/index.css';
import './assets/css/tailwind.css';
import { identifyUser } from './user';

const logoUrl = '/asserts/logo.png';

document.title = '合同审查';
const favicon = document.querySelector('link[rel="icon"]') || document.createElement('link');
favicon.rel = 'icon';
favicon.href = logoUrl;
document.head.appendChild(favicon);

async function main() {
  try {
    await identifyUser();

    const app = createApp(App);
    app.use(router);
    app.mount('#app');
  } catch (error) {
    console.error('Failed to initialize the application:', error);
    document.body.innerHTML = '<div style="text-align: center; margin-top: 50px;"><h1>应用加载失败</h1><p>请检查网络连接或联系管理员。</p></div>';
  }
}

main();

window.ResizeObserver = class _NewResizeObserver extends ResizeObserver {
  constructor(callback) {
    super(() => window.requestAnimationFrame(() => callback.apply(this, arguments)));
  }
};
