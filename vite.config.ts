import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig(({ mode }) => ({
  base: mode === 'demo' ? '/FluidUI/' : '/',
  plugins: [
    react(),
    ...(mode === 'esp32' ? [viteSingleFile()] : []),
  ],
  build: {
    target: 'es2015',
    ...(mode === 'esp32' ? {
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    } : {}),
  },
}))
