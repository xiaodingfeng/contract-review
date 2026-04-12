import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
      extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.vue'],
    },
    server: {
      port: 8080,
      proxy: {
        '/api': {
          target: env.VITE_APP_BACKEND_API_URL || 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    define: {
      'process.env.BASE_URL': JSON.stringify(env.BASE_URL || '/'),
    },
    build: {
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('@onlyoffice')) return 'vendor-onlyoffice';
            if (id.includes('@element-plus/icons-vue')) return 'vendor-element-icons';
            if (id.includes('element-plus/es/components')) {
              const match = id.match(/element-plus\/es\/components\/([^/]+)/);
              return match ? `vendor-element-${match[1]}` : 'vendor-element-components';
            }
            if (id.includes('element-plus/theme-chalk') || id.includes('element-plus/dist')) return 'vendor-element-style';
            if (id.includes('element-plus') || id.includes('@element-plus') || id.includes('@popperjs')) return 'vendor-element-core';
            if (id.includes('marked')) return 'vendor-markdown';
            if (id.includes('socket.io-client') || id.includes('engine.io-client')) return 'vendor-realtime';
            if (id.includes('axios') || id.includes('uuid') || id.includes('@fingerprintjs')) return 'vendor-utils';
            if (id.includes('vue-router') || id.includes('vue')) return 'vendor-vue';
            return 'vendor';
          },
        },
      },
    },
  };
});
