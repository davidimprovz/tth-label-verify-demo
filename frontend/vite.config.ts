import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev server is bound to 0.0.0.0 so it is reachable from the host when run
// inside the container. Polling keeps file-watching reliable across the
// Docker bind mount. /api and /health are proxied to the backend service.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: {
      usePolling: true,
    },
    proxy: {
      '/api': {
        target: 'http://backend:8000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://backend:8000',
        changeOrigin: true,
      },
    },
  },
})
