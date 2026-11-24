import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve('src/renderer'),
  resolve: {
    alias: {
      '@shared': resolve('src/shared')
    }
  },
  optimizeDeps: {
    noDiscovery: true,
    include: ['react', 'react-dom/client', 'lucide-react', '@tauri-apps/api/core', '@tauri-apps/api/event']
  },
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: {
      // 编辑器原子保存会在被监视目录里留下临时目录；Vite 的 watcher 偶发 EBUSY 后整个 dev server 退出。
      ignored: ['**/*.tmpdir/**', '**/.*.tmpdir/**']
    }
  },
  build: {
    outDir: resolve('dist'),
    emptyOutDir: true
  }
})
