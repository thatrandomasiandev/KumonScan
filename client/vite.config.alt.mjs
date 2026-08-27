import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Alternate local preview: UI :5174 → API :3002 (default remains :5173 → :3001). */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
    },
  },
});
