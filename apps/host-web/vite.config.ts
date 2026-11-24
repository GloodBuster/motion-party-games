import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

const useHttps = process.env.VITE_HTTPS !== 'false';
const signalingTarget = process.env.SIGNALING_URL ?? 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: useHttps ? [basicSsl()] : [],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/ws': {
        target: signalingTarget,
        ws: true,
        changeOrigin: true,
      },
      '/api': {
        target: signalingTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    port: 5173,
  },
});
