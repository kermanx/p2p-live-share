/* eslint-disable style/no-mixed-operators */
// Based on https://github.com/microsoft/vscode/blob/main/src/vs/base/node/shell.ts

import type { IProcessEnvironment } from './utils.js'
import { userInfo } from 'node:os'
import { getFirstAvailablePowerShellInstallation } from './powershell.js'
import * as processes from './processes.js'
import { OperatingSystem, platform } from './utils.js'

/**
 * Gets the detected default shell for the _system_, not to be confused with VS Code's _default_
 * shell that the terminal uses by default.
 * @param os The platform to detect the shell of.
 */
export async function getSystemShell(os: OperatingSystem, env: IProcessEnvironment): Promise<string> {
  if (os === OperatingSystem.Windows) {
    if (platform.isWindows) {
      return getSystemShellWindows()
    }
    // Don't detect Windows shell when not on Windows
    return processes.getWindowsShell(env)
  }

  return getSystemShellUnixLike(os, env)
}

let _TERMINAL_DEFAULT_SHELL_UNIX_LIKE: string | null = null
function getSystemShellUnixLike(os: OperatingSystem, env: IProcessEnvironment): string {
  // Only use $SHELL for the current OS
  if (platform.isLinux && os === OperatingSystem.Macintosh || platform.isMacintosh && os === OperatingSystem.Linux) {
    return '/bin/bash'
  }

  if (!_TERMINAL_DEFAULT_SHELL_UNIX_LIKE) {
    let unixLikeTerminal: string | undefined | null
    if (platform.isWindows) {
      unixLikeTerminal = '/bin/bash' // for WSL
    }
    else {
      unixLikeTerminal = env.SHELL

      if (!unixLikeTerminal) {
        try {
          // It's possible for $SHELL to be unset, this API reads /etc/passwd. See https://github.com/github/codespaces/issues/1639
          // Node docs: "Throws a SystemError if a user has no username or homedir."
          unixLikeTerminal = userInfo().shell
        }
        catch { }
      }

      if (!unixLikeTerminal) {
        unixLikeTerminal = 'sh'
      }

      // Some systems have $SHELL set to /bin/false which breaks the terminal
      if (unixLikeTerminal === '/bin/false') {
        unixLikeTerminal = '/bin/bash'
      }
    }
    _TERMINAL_DEFAULT_SHELL_UNIX_LIKE = unixLikeTerminal
  }
  return _TERMINAL_DEFAULT_SHELL_UNIX_LIKE
}

let _TERMINAL_DEFAULT_SHELL_WINDOWS: string | null = null
async function getSystemShellWindows(): Promise<string> {
  if (!_TERMINAL_DEFAULT_SHELL_WINDOWS) {
    _TERMINAL_DEFAULT_SHELL_WINDOWS = (await getFirstAvailablePowerShellInstallation())!.exePath
  }
  return _TERMINAL_DEFAULT_SHELL_WINDOWS
}
