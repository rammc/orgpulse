import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    open: true,
  },
  define: {
    'import.meta.env.VITE_BUILD_MODE': JSON.stringify('local'),
  },
});
