import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath } from 'url'

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      'react':             'preact/compat',
      'react-dom':         'preact/compat',
      'react-dom/client':  'preact/compat/client',
      'react/jsx-runtime': 'preact/jsx-runtime',
      'lucide-react':      fileURLToPath(new URL('./src/icons.tsx', import.meta.url)),
    },
  },
  base: mode === 'demo' ? '/FigUI/' : '/',
  plugins: [
    react(),
    ...(mode === 'esp32' ? [viteSingleFile()] : []),
  ],
  build: {
    target: 'es2022',
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
