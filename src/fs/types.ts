import type { Uri } from 'vscode'
import type * as Y from 'yjs'
import { FileType } from 'vscode'

export type FileContent = FileType | Uint8Array | Y.Text
export type FilesMap = Y.Map<FileContent>

export function isContentTracked(file: FileContent): file is Uint8Array | Y.Text {
  return typeof file !== 'number'
}

export function isDirectory(file: FileContent | undefined): file is FileType {
  return typeof file === 'number' && !!(file & FileType.Directory)
}

export function isFile(file: FileContent | undefined): file is FileType {
  return typeof file === 'number' && !!(file & FileType.File)
}

export function toFileType(file: FileContent) {
  return typeof file === 'number' ? file : FileType.File
}

export function getParent(uri: Uri): string {
  let path = uri.path
  if (path.endsWith('/'))
    path = path.slice(0, -1)
  const lastSlash = path.lastIndexOf('/')
  path = lastSlash !== -1 ? path.slice(0, lastSlash) : path
  return uri.with({ path: path || '/' }).toString()
}

export function getName(uri: Uri): string {
  let path = uri.path
  if (path.endsWith('/'))
    path = path.slice(0, -1)
  const lastSlash = path.lastIndexOf('/')
  return lastSlash !== -1 ? path.slice(lastSlash + 1) : path
}
