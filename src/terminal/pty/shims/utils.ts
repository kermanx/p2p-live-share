import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getAppRoot } from '../utils.js'

export function resolveAsset(path: string) {
  const appRoot = getAppRoot()

  // Strategy 1: Normal node_modules (development / direct install)
  const normalPath = resolve(appRoot, '../node_modules', path)
  if (existsSync(normalPath))
    return normalPath

  // Strategy 2: ASAR unpacked directory (native binaries, worker files)
  const unpackedPath = resolve(appRoot, '../node_modules.asar.unpacked', path)
  if (existsSync(unpackedPath))
    return unpackedPath

  // Strategy 3: Inside ASAR archive — construct the path into node_modules.asar
  // fs.existsSync cannot see inside .asar, but Electron's require() can.
  // We return the path directly; if the file doesn't exist there either,
  // require() will throw a meaningful "Cannot find module" error.
  const asarPath = resolve(appRoot, '../node_modules.asar', path)
  return asarPath
}
