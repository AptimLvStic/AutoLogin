import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { build as buildWithEsbuild } from 'esbuild'
import type { Plugin } from 'vite'

const PAGE_AGENT_VIRTUAL_ID = 'virtual:page-agent-source'
const PAGE_AGENT_RESOLVED_ID = `\0${PAGE_AGENT_VIRTUAL_ID}`

function pageAgentSourcePlugin(): Plugin {
  return {
    name: 'autologin-page-agent-source',
    resolveId(id) {
      return id === PAGE_AGENT_VIRTUAL_ID ? PAGE_AGENT_RESOLVED_ID : null
    },
    async load(id) {
      if (id !== PAGE_AGENT_RESOLVED_ID) {
        return null
      }
      const result = await buildWithEsbuild({
        entryPoints: [resolve('src/preload/agent.ts')],
        absWorkingDir: process.cwd(),
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: 'chrome120',
        minify: true,
        write: false,
        legalComments: 'none'
      })
      const output = result.outputFiles?.[0]?.text
      if (!output) {
        throw new Error('无法生成页面代理脚本')
      }
      return `export default ${JSON.stringify(output)}`
    }
  }
}

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({ exclude: ['zod', 'hash-wasm'] }),
      pageAgentSourcePlugin()
    ],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    optimizeDeps: {
      noDiscovery: true,
      include: ['react', 'react-dom/client', 'lucide-react']
    },
    plugins: [
      {
        name: 'autologin-development-csp',
        transformIndexHtml(html, context) {
          if (!context.server) {
            return html
          }
          return html.replace(
            "connect-src 'self';",
            "connect-src 'self' ws://localhost:* http://localhost:*;"
          )
        }
      },
      react()
    ]
  }
})
