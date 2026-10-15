import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: path.resolve(process.cwd(), 'src/studio'),
  base: './',
  build: {
    outDir: path.resolve(process.cwd(), 'dist/studio'),
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:50098',
      '/v1': 'http://localhost:50098'
    }
  }
});
