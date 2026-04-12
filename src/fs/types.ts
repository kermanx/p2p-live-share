import type { Uri } from 'vscode'
import { FileType } from 'vscode'
import * as Y from 'yjs'

export type FileContent = FileType | Y.Doc
export type FilesMap = Y.Map<FileContent>

export function isContentTracked(file: FileContent | null | undefined): file is Y.Doc {
  return file instanceof Y.Doc
}

export function isDir(file: FileContent | undefined): file is FileType.Directory {
  return typeof file === 'number' && (file & FileType.Directory) !== 0
}

export function toFileType(file: FileContent): FileType {
  return file instanceof Y.Doc ? FileType.File : file
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
