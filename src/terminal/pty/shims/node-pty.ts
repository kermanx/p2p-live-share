import type * as NodePty from 'node-pty'
import { resolveAsset } from './utils'

let nodePty: typeof NodePty | undefined

/**
 * node-pty is not bundled: the copy shipped inside the editor is reused so the
 * native binding matches the editor's Electron ABI. Resolving it is deferred to
 * the first spawn because an editor that does not ship node-pty would otherwise
 * throw while this module is being evaluated, which takes down the whole
 * extension at activation instead of only terminal sharing.
 */
function load(): typeof NodePty {
  // eslint-disable-next-line ts/no-require-imports
  return nodePty ??= require(resolveAsset('node-pty/lib/index.js'))
}

export const spawn: typeof NodePty.spawn = (file, args, options) => load().spawn(file, args, options)
