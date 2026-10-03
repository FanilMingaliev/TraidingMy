import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Относительные пути: одна и та же сборка работает в Android-приложении,
  // на GitHub Pages (в подпапке) и с собственного сервера
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    // Движок общий с сервером и лежит уровнем выше
    alias: { '@core': path.resolve(here, '../core') }
  },
  server: {
    port: 5173,
    fs: { allow: [path.resolve(here, '..')] },
    proxy: {
      '/api': {
        target: process.env.API_URL || 'http://localhost:8787',
        changeOrigin: true
      }
    }
  },
  build: { outDir: 'dist', sourcemap: false }
});
