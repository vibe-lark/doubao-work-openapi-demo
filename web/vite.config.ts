import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// 独立 Node 版前端构建：
//   · 复用 platform-hosted 的 React 组件（已复制到 web/src）
//   · @api/* 指向本地 HTTP 客户端 shim（走同源 fetch('/api/...')，由 server/ 代理豆包）
//   · @shared 指向 web/shared（zod 契约副本，与 platform-hosted/shared 保持一致）
//   · @ 指向 web/src
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@api/auth', replacement: resolve(here, 'src/api-shim/auth.ts') },
      { find: '@api/doubao', replacement: resolve(here, 'src/api-shim/doubao.ts') },
      { find: '@api/boundary', replacement: resolve(here, 'src/api-shim/boundary.ts') },
      { find: '@shared/schema', replacement: resolve(here, 'shared/schema.ts') },
      { find: '@', replacement: resolve(here, 'src') },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4110',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
