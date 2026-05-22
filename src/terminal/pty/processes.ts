// Based on https://github.com/microsoft/vscode/blob/main/src/vs/base/node/processes.ts

import type { Stats } from 'node:fs'
import type { IProcessEnvironment } from './utils.js'
import { promises } from 'node:fs'
import * as path from 'node:path'
import { getCaseInsensitive, pfs, Platform, processCommon, Types } from './utils.js'

export function getWindowsShell(env = processCommon.env as IProcessEnvironment): string {
  return env.comspec || 'cmd.exe'
}

async function fileExistsDefault(path: string): Promise<boolean> {
  if (await pfs.Promises.exists(path)) {
    let statValue: Stats | undefined
    try {
      statValue = await promises.stat(path)
    }
    catch (e: any) {
      if (e.message.startsWith('EACCES')) {
        // it might be symlink
        statValue = await promises.lstat(path)
      }
    }
    return statValue ? !statValue.isDirectory() : false
  }
  return false
}

export async function findExecutable(command: string, cwd?: string, paths?: string[], env = processCommon.env, fileExists: (path: string) => Promise<boolean> = fileExistsDefault): Promise<string | undefined> {
  // If we have an absolute path then we take it.
  if (path.isAbsolute(command)) {
    return await fileExists(command) ? command : undefined
  }
  if (cwd === undefined) {
    cwd = processCommon.cwd()
  }
  const dir = path.dirname(command)
  if (dir !== '.') {
    // We have a directory and the directory is relative (see above). Make the path absolute
    // to the current working directory.
    const fullPath = path.join(cwd, command)
    return await fileExists(fullPath) ? fullPath : undefined
  }
  const envPath = getCaseInsensitive(env, 'PATH')
  if (paths === undefined && Types.isString(envPath)) {
    paths = envPath.split(path.delimiter)
  }
  // No PATH environment. Make path absolute to the cwd.
  if (paths === undefined || paths.length === 0) {
    const fullPath = path.join(cwd, command)
    return await fileExists(fullPath) ? fullPath : undefined
  }

  // We have a simple file name. We get the path variable from the env
  // and try to find the executable on the path.
  for (const pathEntry of paths) {
    // The path entry is absolute.
    let fullPath: string
    if (path.isAbsolute(pathEntry)) {
      fullPath = path.join(pathEntry, command)
    }
    else {
      fullPath = path.join(cwd, pathEntry, command)
    }
    if (Platform.isWindows) {
      const pathExt = getCaseInsensitive(env, 'PATHEXT') as string || '.COM;.EXE;.BAT;.CMD'
      const pathExtsFound = pathExt.split(';').map(async (ext) => {
        const withExtension = fullPath + ext
        return await fileExists(withExtension) ? withExtension : undefined
      })
      for (const foundPromise of pathExtsFound) {
        const found = await foundPromise
        if (found) {
          return found
        }
      }
    }

    if (await fileExists(fullPath)) {
      return fullPath
    }
  }
  const fullPath = path.join(cwd, command)
  return await fileExists(fullPath) ? fullPath : undefined
}
