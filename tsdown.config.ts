import { copyFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'tsdown'

const needsStub = [
  'src/session/host.ts',
  'src/tunnel/index.ts',
  'src/ui/tunnels.ts',
]

export default defineConfig([
  {
    entry: ['src/extension.ts'],
    platform: 'node',
    format: ['cjs'],
    target: 'node22',
    external: [
      'vscode',
    ],
    define: {
      'import.meta.env.TARGET': '"node"',
    },
    inputOptions: {
      resolve: {
        alias: {
          'vscode-languageserver/browser': 'vscode-languageserver/node',
          'vscode-languageclient/browser': 'vscode-languageclient/node',
          'node-pty': resolve(import.meta.dirname, './src/terminal/pty/shims/node-pty.ts'),
          '@vscode/windows-process-tree': resolve(import.meta.dirname, './src/terminal/pty/shims/windows-process-tree.ts'),
        },
      },
    },
    plugins: [
      {
        name: 'patch-deps-assets',
        transform: {
          order: 'pre',
          filter: {
            id: [
              '**/node-pty/lib/unixTerminal.js',
              '**/node-pty/lib/windowsPtyAgent.js',
              '**/node-pty/lib/windowsConoutConnection.js',
            ],
          },
          handler(code, id) {
            const subpath = id.split('/node_modules/').at(-1)!
            console.log('Patching', subpath)
            const utils = resolve(import.meta.dirname, './src/terminal/pty/shims/utils.ts')
            const patched = `((() => require(${JSON.stringify(utils)}).resolveAsset(${JSON.stringify(dirname(subpath))}))())`
            return code.replaceAll('__dirname', patched)
          },
        },
        load: {
          order: 'pre',
          filter: {
            id: [
              '**/vscode-languageclient/lib/node/processes.js',
            ],
          },
          handler() {
            return '"use strict";\nmodule.exports = {};'
          },
        },
      },
    ],
  },
  {
    entry: {
      browser: 'src/extension.ts',
    },
    // outExtensions: ({ format }) => format === 'cjs'
    //   ? {
    //       js: '.js',
    //     }
    //   : undefined,
    platform: 'browser',
    format: ['cjs'],
    target: 'es2020',
    external: [
      'vscode',
    ],
    define: {
      'import.meta.env.TARGET': '"browser"',
    },
    inputOptions: {
      resolve: {
        conditionNames: ['browser', 'module', 'main'],
        alias: Object.fromEntries(
          needsStub.map(path => [
            resolve(import.meta.dirname, path),
            resolve(import.meta.dirname, path.replace(/\.ts$/, '.stub.ts')),
          ]),
        ),
      },
    },
  },
  {
    entry: {
      webview: 'src/ui/webview/main.tsx',
    },
    platform: 'browser',
    format: ['esm'],
    target: 'es2020',
    define: {
      'import.meta.env.TARGET': '"webview"',
      '__VUE_OPTIONS_API__': 'false',
      '__VUE_PROD_DEVTOOLS__': 'false',
      '__VUE_PROD_HYDRATION_MISMATCH_DETAILS__': 'false',
    },
    inputOptions: {
      transform: {
        jsx: {
          runtime: 'automatic',
          importSource: 'vue',
        },
      },
    },
    onSuccess() {
      copyFileSync('src/ui/webview/styles.css', 'dist/webview.css')
    },
  },
])
