import { defineConfig } from 'vite';
import {resolve} from 'node:path';
const demo=Boolean(process.env.VITE_MUSE_DEMO);
export default defineConfig({
  root:demo?'demo':'.',
  publicDir:resolve('public'),
  base: process.env.MUSE_BASE_PATH || '/',
  build: { target: 'es2022', outDir:resolve(demo?'dist-demo':'dist'),emptyOutDir:true,
    rollupOptions:demo?undefined:{input:{main:resolve('index.html'),project:resolve('project/index.html'),'tower-history':resolve('tower-history/index.html')}},
  },
  server: { port: 5173, strictPort: true },
});
