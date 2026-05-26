import { dirname, resolve } from 'node:path'
import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['src/extension.ts'],
    platform: 'node',
    format: ['cjs'],
    target: 'node22',
    sourcemap: true,
    external: [
      'vscode',
    ],
    define: {
      'import.meta.env.TARGET': '"node"',
      '__DEV__': 'true',
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
    platform: 'browser',
    format: ['cjs'],
    target: 'es2020',
    sourcemap: true,
    external: [
      'vscode',
    ],
    define: {
      'import.meta.env.TARGET': '"browser"',
      '__DEV__': 'true',
    },
    inputOptions: {
      resolve: {
        conditionNames: ['browser', 'module', 'main'],
        alias: {

          'node-pty': resolve(import.meta.dirname, './src/terminal/pty/shims/node-pty.ts'),
          '@vscode/windows-process-tree': resolve(import.meta.dirname, './src/terminal/pty/shims/windows-process-tree.ts'),
        }
      },
    },
  }
])