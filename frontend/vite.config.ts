/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The FastAPI backend serves /api on port 8000. In development Vite proxies to it;
// in production FastAPI serves the built files from frontend/dist.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
