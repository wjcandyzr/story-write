import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 4000,
    proxy: {
      // REST → Nest at :3000/api
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Socket.IO 客户端无论指定哪个 namespace,实际握手 URL 都是 /socket.io/...
      // 所以代理路径必须是 /socket.io,不是 /ws。`ws: true` 是 WebSocket 升级
      // 必需的;少了就只能走长轮询,经常超时。
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
      // Swagger 也代理一下,方便从 :4000 直接打开
      '/docs': 'http://localhost:3000',
    },
  },
});
