import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.MUSE_BASE_PATH || '/',
  build: { target: 'es2022' },
  server: { port: 5173, strictPort: true },
});
