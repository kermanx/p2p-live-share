import type * as Y from 'yjs'
import type { YTuple } from '../sync/y-tuple'
import type { Status } from './git'

export type ScmMap = Y.Map<ScmRepo>

export type ScmRepo = YTuple<[Y.Map<ScmGroup>, ScmRepoMeta]>
export interface ScmRepoMeta {
  label: string
  name: string
  rootUri: string
}

export type ScmGroup = YTuple<[Y.Array<ScmChange>, ScmGroupMeta]>
export interface ScmGroupMeta {
  groupId: string
  label: string
  hideWhenEmpty?: boolean
  supportsClean?: boolean
  supportsOpenChanges?: boolean
  supportsOpenFile?: boolean
}

export interface ScmChange {
  uri: string
  status: Status
}
