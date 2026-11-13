import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss()],
  server: { host: true, proxy: { '/api': { target: 'http://127.0.0.1:7331', changeOrigin: true } } },
  build: { outDir: 'dist' },
});
