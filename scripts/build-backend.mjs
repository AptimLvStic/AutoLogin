import { resolve } from 'node:path'
import { build } from 'esbuild'

const root = process.cwd()
const pageAgentVirtualId = 'virtual:page-agent-source'

const pageAgentPlugin = {
  name: 'autologin-page-agent-source',
  setup(buildContext) {
    buildContext.onResolve({ filter: /^virtual:page-agent-source$/ }, () => ({
      path: pageAgentVirtualId,
      namespace: 'autologin-virtual'
    }))
    buildContext.onLoad(
      { filter: /.*/, namespace: 'autologin-virtual' },
      async () => {
        const result = await build({
          entryPoints: [resolve(root, 'src/preload/agent.ts')],
          absWorkingDir: root,
          bundle: true,
          format: 'iife',
          platform: 'browser',
          target: 'chrome120',
          minify: true,
          write: false,
          legalComments: 'none'
        })
        const source = result.outputFiles?.[0]?.text
        if (!source) {
          throw new Error('Unable to build the page agent source')
        }
        return {
          contents: `export default ${JSON.stringify(source)}`,
          loader: 'js'
        }
      }
    )
  }
}

const aliasPlugin = {
  name: 'autologin-backend-aliases',
  setup(buildContext) {
    buildContext.onResolve({ filter: /^electron(?:-updater)?$/ }, () => ({
      path: resolve(root, 'src/tauri/electron-shim.ts')
    }))
    buildContext.onResolve({ filter: /^@shared\// }, (args) => ({
      path: resolve(root, `src/shared/${args.path.slice('@shared/'.length)}.ts`)
    }))
  }
}

await build({
  entryPoints: [resolve(root, 'src/tauri/backend.ts')],
  absWorkingDir: root,
  outfile: resolve(root, 'dist-backend/backend.cjs'),
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  sourcemap: 'linked',
  legalComments: 'none',
  define: {
    'process.env.NODE_ENV': '"production"'
  },
  plugins: [aliasPlugin, pageAgentPlugin]
})

console.log('Built dist-backend/backend.cjs')
