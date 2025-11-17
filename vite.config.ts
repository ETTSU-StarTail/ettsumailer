import { defineConfig } from 'vite'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  // prevent vite from obscuring rust errors
  clearScreen: false,
  // Tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
  },
  // Set root to src directory so index.html can be found there
  root: 'src',
  // Build output to ../dist (relative to root which is src/)
  build: {
    outDir: '../dist',
    // Empty the output directory before building
    emptyOutDir: true,
  },
})
