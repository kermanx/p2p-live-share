import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { window } from 'vscode'
import { getAppRoot } from '../utils.js'

export function resolveAsset(path: string) {
  const appRoot = getAppRoot()
  const resolved = resolve(appRoot, '../node_modules', path)
  if (!existsSync(resolved)) {
    window.showErrorMessage(`Asset not found: ${path}`)
    throw new Error(`Asset not found: ${path}`)
  }
  return resolved
}
