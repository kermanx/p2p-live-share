/* eslint-disable ts/no-namespace */
import fs from 'node:fs'
import { readdir } from 'node:fs/promises'
import path, { dirname } from 'node:path'
import process from 'node:process'
import { extensionContext } from 'reactive-vscode'
import { env, Uri } from 'vscode'
import { lazy } from '../../utils'

export const isLinux = process.platform === 'linux'
export const isMacintosh = process.platform === 'darwin'
export const isWindows = process.platform === 'win32'

export const timeout = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export function localize(key: string, message: string, ...args: any[]) {
  return message.replace(/\{(\d+)\}/g, (match, number) => {
    const index = Number.parseInt(number, 10)
    return !Number.isNaN(index) && index < args.length ? args[index] : match
  })
}

export class Disposable {
  private _isDisposed = false
  private _disposables: { dispose: () => void }[] = []

  get _store() {
    return {
      isDisposed: this._isDisposed,
    }
  }

  protected _register<T extends { dispose: () => void }>(t: T): T {
    if (this._isDisposed) {
      t.dispose()
    }
    else {
      this._disposables.push(t)
    }
    return t
  }

  dispose(): void {
    if (!this._isDisposed) {
      this._isDisposed = true
      this._disposables.forEach(d => d.dispose())
    }
  }
}

export function toDisposable(disposable: () => void) {
  return { dispose: disposable }
}

export interface IDebounceReducer<T> {
  (previousValue: T, ...args: any[]): T
}

// eslint-disable-next-line ts/no-unsafe-function-type
export function createDecorator(mapFn: (fn: Function, key: string) => Function): MethodDecorator {
  return (_target: object, key: string | symbol, descriptor: TypedPropertyDescriptor<any>) => {
    let fnKey: 'value' | 'get' | null = null
    // eslint-disable-next-line ts/no-unsafe-function-type
    let fn: Function | null = null

    if (typeof descriptor.value === 'function') {
      fnKey = 'value'
      fn = descriptor.value
    }
    else if (typeof descriptor.get === 'function') {
      fnKey = 'get'
      fn = descriptor.get
    }

    if (!fn || typeof key === 'symbol') {
      throw new Error('not supported')
    }

    descriptor[fnKey!] = mapFn(fn, key)
  }
}

export function debounce<T>(delay: number, reducer?: IDebounceReducer<T>, initialValueProvider?: () => T) {
  return createDecorator((fn, key) => {
    const timerKey = `$debounce$${key}`
    const resultKey = `$debounce$result$${key}`

    return function (this: any, ...args: any[]) {
      if (!this[resultKey]) {
        this[resultKey] = initialValueProvider ? initialValueProvider() : undefined
      }

      clearTimeout(this[timerKey])

      if (reducer) {
        this[resultKey] = reducer(this[resultKey], ...args)
        args = [this[resultKey]]
      }

      this[timerKey] = setTimeout(() => {
        fn.apply(this, args)
        this[resultKey] = initialValueProvider ? initialValueProvider() : undefined
      }, delay)
    }
  })
}

export function throttle<T>(delay: number, reducer?: IDebounceReducer<T>, initialValueProvider?: () => T) {
  return createDecorator((fn, key) => {
    const timerKey = `$throttle$timer$${key}`
    const resultKey = `$throttle$result$${key}`
    const lastRunKey = `$throttle$lastRun$${key}`
    const pendingKey = `$throttle$pending$${key}`

    return function (this: any, ...args: any[]) {
      if (!this[resultKey]) {
        this[resultKey] = initialValueProvider ? initialValueProvider() : undefined
      }
      if (this[lastRunKey] === null || this[lastRunKey] === undefined) {
        this[lastRunKey] = -Number.MAX_VALUE
      }

      if (reducer) {
        this[resultKey] = reducer(this[resultKey], ...args)
      }

      if (this[pendingKey]) {
        return
      }

      const nextTime = this[lastRunKey] + delay
      if (nextTime <= Date.now()) {
        this[lastRunKey] = Date.now()
        fn.apply(this, [this[resultKey]])
        this[resultKey] = initialValueProvider ? initialValueProvider() : undefined
      }
      else {
        this[pendingKey] = true
        this[timerKey] = setTimeout(() => {
          this[pendingKey] = false
          this[lastRunKey] = Date.now()
          fn.apply(this, [this[resultKey]])
          this[resultKey] = initialValueProvider ? initialValueProvider() : undefined
        }, nextTime - Date.now())
      }
    }
  })
}

interface obj { [key: string]: any }
export function getCaseInsensitive(target: obj, key: string): unknown {
  const lowercaseKey = key.toLowerCase()
  const equivalentKey = Object.keys(target).find(k => k.toLowerCase() === lowercaseKey)
  return equivalentKey ? target[equivalentKey] : target[key]
}

const _formatRegexp = /\{(\d+)\}/g
export function format(value: string, ...args: any[]): string {
  if (args.length === 0) {
    return value
  }
  return value.replace(_formatRegexp, (match, group) => {
    const idx = Number.parseInt(group, 10)
    return Number.isNaN(idx) || idx < 0 || idx >= args.length
      ? match
      : args[idx]
  })
}

// Based on https://github.com/subframe7536/vscode-custom-ui-style/blob/main/src/path.ts
export const getAppRoot = lazy(() => {
  function getDirectoryName(filePath: string): string {
    const lastSlashIndex = Math.max(
      filePath.lastIndexOf('/'),
      filePath.lastIndexOf('\\'),
    )

    if (lastSlashIndex === -1) {
      return ''
    }

    return filePath.substring(0, lastSlashIndex)
  }

  const envAppRoot = env.appRoot
  if (envAppRoot && fs.existsSync(envAppRoot)) {
    return path.join(envAppRoot, 'out')
  }
  const mainFilename = require.main?.filename.replace(/\\/g, '/')
  if (!mainFilename) {
    const msg = 'Cannot determine main file name'
    console.error(msg)
    throw new Error(msg)
  }

  // `path.dirname(mainFilename)` will return '.' in extension, so here manually extract it
  return getDirectoryName(mainFilename)
})

export const FileAccess = {
  asFileUri(path: string) {
    if (path === '') {
      return Uri.file(dirname(getAppRoot()))
    }
    if (!path.startsWith('vs/base/node/')) {
      throw new Error(`Only paths under vs/base/node/ are supported. Got: ${path}`)
    }
    path = path.replace('vs/base/node/', 'assets/')
    return {
      fsPath: extensionContext.value!.asAbsolutePath(path),
    }
  },
}

export const Types = {
  isString: (value: any): value is string => typeof value === 'string',
}

export const Platform = {
  isWindows,
  isMacintosh,
  isLinux,
}

export const platform = Platform

// eslint-disable-next-line no-restricted-syntax
export const enum OperatingSystem {
  Windows = 1,
  Macintosh = 2,
  Linux = 3,
}
export const OS = (isMacintosh ? OperatingSystem.Macintosh : (isWindows ? OperatingSystem.Windows : OperatingSystem.Linux))

export const pfs = {
  Promises: {
    async exists(path: string): Promise<boolean> {
      try {
        await fs.promises.access(path)

        return true
      }
      catch {
        return false
      }
    },
  },
}

export const processCommon = {
  env: process.env,
  cwd: () => process.cwd(),
}

export type IProcessEnvironment = any

export const productService = {
  quality: 'stable',
  applicationName: 'p2p-live-share',
}

export type IWorkspaceFolderData = any

export type UriComponents = any

export type ISerializedCommandDetectionCapability = any

export const Promises = {
  withAsyncBody<T, E = Error>(bodyFn: (resolve: (value: T) => unknown, reject: (error: E) => unknown) => Promise<unknown>): Promise<T> {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise<T>(async (resolve, reject) => {
      try {
        await bodyFn(resolve, reject)
      }
      catch (error) {
        reject(error)
      }
    })
  },

  readdir,
}

export namespace SymlinkSupport {

  export interface IStats {

    // The stats of the file. If the file is a symbolic
    // link, the stats will be of that target file and
    // not the link itself.
    // If the file is a symbolic link pointing to a non
    // existing file, the stat will be of the link and
    // the `dangling` flag will indicate this.
    stat: fs.Stats

    // Will be provided if the resource is a symbolic link
    // on disk. Use the `dangling` flag to find out if it
    // points to a resource that does not exist on disk.
    symbolicLink?: { dangling: boolean }
  }

  /**
   * Resolves the `fs.Stats` of the provided path. If the path is a
   * symbolic link, the `fs.Stats` will be from the target it points
   * to. If the target does not exist, `dangling: true` will be returned
   * as `symbolicLink` value.
   */
  export async function stat(path: string): Promise<IStats> {
    // First stat the link
    let lstats: fs.Stats | undefined
    try {
      lstats = await fs.promises.lstat(path)

      // Return early if the stat is not a symbolic link at all
      if (!lstats.isSymbolicLink()) {
        return { stat: lstats }
      }
    }
    catch {
      /* ignore - use stat() instead */
    }

    // If the stat is a symbolic link or failed to stat, use fs.stat()
    // which for symbolic links will stat the target they point to
    try {
      const stats = await fs.promises.stat(path)

      return { stat: stats, symbolicLink: lstats?.isSymbolicLink() ? { dangling: false } : undefined }
    }
    catch (error: any) {
      // If the link points to a nonexistent file we still want
      // to return it as result while setting dangling: true flag
      if (error.code === 'ENOENT' && lstats) {
        return { stat: lstats, symbolicLink: { dangling: true } }
      }

      // Windows: workaround a node.js bug where reparse points
      // are not supported (https://github.com/nodejs/node/issues/36790)
      if (isWindows && error.code === 'EACCES') {
        try {
          const stats = await fs.promises.stat(await fs.promises.readlink(path))

          return { stat: stats, symbolicLink: { dangling: false } }
        }
        catch (error: any) {
          // If the link points to a nonexistent file we still want
          // to return it as result while setting dangling: true flag
          if (error.code === 'ENOENT' && lstats) {
            return { stat: lstats, symbolicLink: { dangling: true } }
          }

          throw error
        }
      }

      throw error
    }
  }

  /**
   * Figures out if the `path` exists and is a file with support
   * for symlinks.
   *
   * Note: this will return `false` for a symlink that exists on
   * disk but is dangling (pointing to a nonexistent path).
   *
   * Use `exists` if you only care about the path existing on disk
   * or not without support for symbolic links.
   */
  export async function existsFile(path: string): Promise<boolean> {
    try {
      const { stat, symbolicLink } = await SymlinkSupport.stat(path)

      return stat.isFile() && symbolicLink?.dangling !== true
    }
    catch {
      // Ignore, path might not exist
    }

    return false
  }

  /**
   * Figures out if the `path` exists and is a directory with support for
   * symlinks.
   *
   * Note: this will return `false` for a symlink that exists on
   * disk but is dangling (pointing to a nonexistent path).
   *
   * Use `exists` if you only care about the path existing on disk
   * or not without support for symbolic links.
   */
  export async function existsDirectory(path: string): Promise<boolean> {
    try {
      const { stat, symbolicLink } = await SymlinkSupport.stat(path)

      return stat.isDirectory() && symbolicLink?.dangling !== true
    }
    catch {
      // Ignore, path might not exist
    }

    return false
  }
}
