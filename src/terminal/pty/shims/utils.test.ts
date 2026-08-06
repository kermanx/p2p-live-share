import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
// eslint-disable-next-line test/no-import-node-test
import { after, before, describe, it } from 'node:test'

// resolveAsset 的独立实现，不依赖 vscode 的 getAppRoot
// 用于测试路径解析逻辑本身
function resolveAssetWithRoot(
  path: string,
  appRoot: string,
  _exists: (p: string) => boolean = existsSync,
): string {
  // Strategy 1: Normal node_modules (development / direct install)
  const normalPath = resolve(appRoot, '..', 'node_modules', path)
  if (_exists(normalPath))
    return normalPath

  // Strategy 2: ASAR unpacked directory (native modules bundled with VS Code)
  const unpackedPath = resolve(appRoot, '..', 'node_modules.asar.unpacked', path)
  if (_exists(unpackedPath))
    return unpackedPath

  // Strategy 3: Inside ASAR archive — return the path directly
  // Electron's require() handles .asar paths transparently
  return resolve(appRoot, '..', 'node_modules.asar', path)
}

describe('resolveAsset path resolution', () => {
  let tmpDir: string

  before(() => {
    // 用临时目录模拟 VS Code 的 app root 结构
    tmpDir = resolve(tmpdir(), `p2p-ls-test-${Date.now()}`)
    // appRoot = tmpDir/out (模拟 VS Code 的 env.appRoot + '/out')
  })

  after(() => {
    // Cleanup handled by the test framework's tmp dir
  })

  it('finds asset in normal node_modules/', () => {
    // path.resolve 会规范化掉 ..，所以最终路径是 <tmpDir>/node_modules/...
    const appRoot = resolve(tmpDir, 'out')
    const expectedBase = resolve(appRoot, '..', 'node_modules')
    const exists = (p: string) => p.startsWith(expectedBase)
    const result = resolveAssetWithRoot('node-pty/lib/index.js', appRoot, exists)
    assert.ok(result.includes('node_modules'), `Expected path to include node_modules, got: ${result}`)
    assert.ok(!result.includes('.asar'), `Expected non-ASAR path, got: ${result}`)
  })

  it('falls back to node_modules.asar.unpacked when normal path missing', () => {
    const appRoot = resolve(tmpDir, 'out')
    // 精确匹配：normal path 是 <tmpDir>/node_modules/<path>, asar path 是 <tmpDir>/node_modules.asar.unpacked/<path>
    const normalFilePath = resolve(appRoot, '..', 'node_modules', 'node-pty/lib/index.js')
    const asarFilePath = resolve(appRoot, '..', 'node_modules.asar.unpacked', 'node-pty/lib/index.js')
    const exists = (p: string) => {
      if (p === normalFilePath) return false  // normal path 不存在
      if (p === asarFilePath) return true     // asar path 存在
      return false
    }
    const result = resolveAssetWithRoot('node-pty/lib/index.js', appRoot, exists)
    assert.ok(result.includes('node_modules.asar.unpacked'), `Expected .asar.unpacked path, got: ${result}`)
  })

  it('returns ASAR archive path when both fs paths miss', () => {
    const exists = (_p: string) => false
    const appRoot = resolve(tmpDir, 'out')
    const expected = resolve(appRoot, '..', 'node_modules.asar', 'node-pty/lib/index.js')
    const result = resolveAssetWithRoot('node-pty/lib/index.js', appRoot, exists)
    assert.equal(result, expected)
  })

  it('normal path is tried before asar path', () => {
    const callOrder: string[] = []
    const appRoot = resolve(tmpDir, 'out')
    const normalFilePath = resolve(appRoot, '..', 'node_modules', 'pkg/index.js')
    const asarFilePath = resolve(appRoot, '..', 'node_modules.asar.unpacked', 'pkg/index.js')
    const exists = (p: string) => {
      if (p === normalFilePath) {
        callOrder.push('normal')
        return false
      }
      if (p === asarFilePath) {
        callOrder.push('asar')
        return true
      }
      return false
    }
    resolveAssetWithRoot('pkg/index.js', appRoot, exists)
    assert.deepEqual(callOrder, ['normal', 'asar'], 'Normal path must be checked before ASAR path')
  })
})
