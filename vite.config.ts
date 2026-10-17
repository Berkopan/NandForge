import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.NANDFORGE_BASE ?? '/NandForge/',
  server: { host: '0.0.0.0', port: 4173, strictPort: true, allowedHosts: ['terminal.local'] },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true, allowedHosts: ['terminal.local'] },
  build: { sourcemap: true, chunkSizeWarningLimit: 800 },
});
