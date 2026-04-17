import { defineConfig } from 'vite';

export default defineConfig({
  base: '/orgpulse/',
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    open: true,
  },
});
