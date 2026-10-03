import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getAppRoot } from '../utils.js'

/**
 * VS Code 1.130 moved the dependencies it ships from a plain `node_modules`
 * directory into `node_modules.asar`, keeping only a handful of packages in the
 * former. Electron resolves `require` and `existsSync` inside the archive
 * transparently, and redirects native `.node` files to the sibling
 * `node_modules.asar.unpacked`, so both roots can be probed the same way.
 */
const assetRoots = ['../node_modules', '../node_modules.asar']

function tryResolveAsset(path: string): string | undefined {
  const appRoot = getAppRoot()
  for (const root of assetRoots) {
    const resolved = resolve(appRoot, root, path)
    if (existsSync(resolved)) {
      return resolved
    }
  }
  return undefined
}

export function resolveAsset(path: string): string {
  const resolved = tryResolveAsset(path)
  if (!resolved) {
    const searched = assetRoots.map(root => resolve(getAppRoot(), root)).join(', ')
    throw new Error(`Asset not found: ${path} (searched ${searched})`)
  }
  return resolved
}
