import type { EffectScope } from 'reactive-vscode'
import type { Connection } from '../sync/connection'
import type { API, Change, GitExtension, Repository, RepositoryState } from './git'
import type { ScmChange, ScmGroup, ScmGroupMeta, ScmRepo, ScmRepoMeta } from './types'
import process from 'node:process'
import { basename } from 'pathe'
import { effectScope, getCurrentScope, useDisposable } from 'reactive-vscode'
import { env, extensions, Uri, workspace } from 'vscode'
import * as Y from 'yjs'
import { YTuple } from '../sync/y-tuple'

export function useHostScm(connection: Connection, doc: Y.Doc) {
  const { toHostUri } = connection
  const scope = getCurrentScope()!
  const _git = (async () => {
    const gitExtension = extensions.getExtension<GitExtension>('vscode.git')
    if (!gitExtension)
      return null
    await gitExtension.activate()
    const gitApi = gitExtension.exports.getAPI(1)
    return scope.run(() => useHostGitScm(gitApi, connection, doc))
  })()

  return {
    async scmClean(repoUri: string, groupId: string, resourceUris: string[]) {
      const git = await _git
      if (!git)
        return
      const repo = git.repositories.get(repoUri)
      if (!repo)
        return
      await repo.repo.clean(resourceUris.map((uri_) => {
        const uri = toHostUri(Uri.parse(uri_))
        return uri.fsPath
      }))
    },
    scmShouldDiscardUntrackedChangesToTrash() {
      const isLinux = process.platform === 'linux'
      const isRemote = env.remoteName !== undefined
      const isLinuxSnap = isLinux && !!process.env.SNAP && !!process.env.SNAP_REVISION
      const config = workspace.getConfiguration('git')
      return config.get<boolean>('discardUntrackedChangesToTrash', true) && !isRemote && !isLinuxSnap
    },
  }
}

function useHostGitScm(api: API, connection: Connection, doc: Y.Doc) {
  const { toTrackUri } = connection
  const map = doc.getMap<ScmRepo>('scm')

  // let instanceCount = 0
  // const rootUriToInstanceId = new Map<string, string>()
  // const changedInstances = new Set()
  // const resourceCache = new Map()

  const repositories = new Map<string, {
    scope: EffectScope
    repo: Repository
  }>()
  const openRepository = (repo: Repository) => {
    const uri = toTrackUri(repo.rootUri)?.toString()
    if (!uri)
      return
    const scope = effectScope(true)
    repositories.set(uri, {
      scope,
      repo,
    })
    map.set(uri, scope.run(() => useScmRepo(repo, {
      rootUri: uri,
      label: 'Git',
      name: basename(repo.rootUri.fsPath) || repo.rootUri.fsPath,
    }))!)
  }

  api.repositories.forEach(openRepository)
  useDisposable(api.onDidOpenRepository(openRepository))
  useDisposable(api.onDidCloseRepository((repo) => {
    const uri = toTrackUri(repo.rootUri)?.toString()
    if (!uri)
      return
    map.delete(uri)
    const repository = repositories.get(uri)
    if (repository) {
      repository.scope.stop()
      repositories.delete(uri)
    }
  }))

  // const documentUriCacheCleanupTimer = setInterval(cleanupDocumentUriCache, 300000)
  // onScopeDispose(() => clearInterval(documentUriCacheCleanupTimer))

  return {
    api,
    repositories,
  }

  // function getInstanceId(repo: Repository) {
  //   const rootUriString = repo.rootUri.toString()
  //   let instanceId = rootUriToInstanceId.get(rootUriString)
  //   if (!instanceId) {
  //     instanceCount++
  //     instanceId = instanceCount.toString(10)
  //     rootUriToInstanceId.set(rootUriString, instanceId)
  //   }
  //   return instanceId
  // }

  // function isInstance(repo: Repository, instanceId: string) {
  //   return (
  //     repo
  //     && repo.rootUri
  //     && instanceId
  //     && rootUriToInstanceId.get(repo.rootUri.toString()) === instanceId
  //   )
  // }

  // async function getSourceControls(instanceId?: string) {
  //   const sourceControls = api.repositories
  //     .filter(repo => !instanceId || isInstance(repo, instanceId))
  //     .map(async (repo) => {
  //       const name = basename(repo.rootUri.fsPath) || repo.rootUri.fsPath
  //       return {
  //         sourceControlId: 'git',
  //         instanceId: getInstanceId(repo),
  //         label: 'Git',
  //         name,
  //         resourceGroups: await getResourceGroups(repo),
  //       }
  //     })
  //   return (await Promise.all(sourceControls)).filter(Boolean)
  // }

  function useScmRepo({ state }: Repository, meta: ScmRepoMeta): ScmRepo {
    const groups = new Y.Map<ScmGroup>()
    groups.set('merge', useScmGroup(state, 'mergeChanges', {
      groupId: 'merge',
      label: 'Merge Changes',
      hideWhenEmpty: true,
      supportsOpenFile: true,
    }))
    groups.set('index', useScmGroup(state, 'indexChanges', {
      groupId: 'index',
      label: 'Staged Changes',
      hideWhenEmpty: true,
      supportsOpenChanges: true,
      supportsOpenFile: true,
    }))
    groups.set('workingTree', useScmGroup(state, 'workingTreeChanges', {
      groupId: 'workingTree',
      label: 'Changes',
      supportsClean: true,
      supportsOpenChanges: true,
      supportsOpenFile: true,
    }))
    return new YTuple(groups, meta)
  }

  function useScmGroup(
    state: RepositoryState,
    key: 'mergeChanges' | 'indexChanges' | 'workingTreeChanges',
    meta: ScmGroupMeta,
  ): ScmGroup {
    const array = new Y.Array<ScmChange>()

    const updateResourceStates = () => {
      const changes = state[key]
      const resourceStates = changes
        .map(change => getResourceState(change))
        .filter((rs): rs is ScmChange => !!rs)

      doc.transact(() => {
        if (array.doc) {
          array.delete(0, array.length)
        }
        array.push(resourceStates)
      })
    }
    updateResourceStates()
    useDisposable(state.onDidChange(updateResourceStates))

    return new YTuple(array, meta)
  }

  function getResourceState(change: Change): ScmChange | undefined {
    if (!change)
      return
    const uri = toTrackUri(change.uri)
    if (!uri)
      return
    return {
      uri: uri.toString(),
      status: change.status,
    }
  }

  // async function getRecentVersions(instanceId: string) {
  //   const repo = getRepoByInstanceId(instanceId)
  //   if (!repo)
  //     return []
  //   const version = repo.state.HEAD
  //     && getVersionFromCommitHash(repo.state.HEAD.commit)
  //   return version ? [version] : []
  // }

  // function getRepoByInstanceId(instanceId: string) {
  //   return api.repositories.find(repo => isInstance(repo, instanceId))
  // }

  // async function getRecentVersionsTillMergeVersion(versionId: string, instanceId: string) {
  //   const repo = getRepoByInstanceId(instanceId)
  //   if (!repo)
  //     return []
  //   const version = repo.state.HEAD
  //     && getVersionFromCommitHash(repo.state.HEAD.commit)
  //   return version ? [version] : []
  // }

  // function getCurrentVersionName(instanceId: string) {
  //   const repo = getRepoByInstanceId(instanceId)
  //   return repo?.state.HEAD?.name
  // }

  // function getRemoteVersionsNames(instanceId: string) {
  //   const repo = getRepoByInstanceId(instanceId)
  //   return repo
  //     ? repo.state.refs.map(ref => ref.name)
  //     : []
  // }

  // async function getMergeVersion(instanceId: string, branch: string) {
  //   const repo = getRepoByInstanceId(instanceId)
  //   if (!repo)
  //     return null
  //   const branchInfo = await repo.getBranch(branch)
  //   const mergeBase = await repo.getMergeBase(repo.state.HEAD!.name!, branchInfo.name!)
  //   return getVersionFromCommitHash(mergeBase)
  // }

  // async function getDiffsForVersion(instanceId: string, version: string) {
  //   const repo = getRepoByInstanceId(instanceId)
  //   if (!repo || !version)
  //     return []
  //   const versionData = JSON.parse(version)
  //   if (!repo.state.HEAD || repo.state.HEAD.commit !== versionData.ref)
  //     return []
  //   const allChanges: Change[] = []
  //   const indexChangesMap = new Map(
  //     repo.state.indexChanges.map(change => [change.uri.toString(), change]),
  //   )
  //   for (const change of repo.state.workingTreeChanges) {
  //     indexChangesMap.delete(change.uri.toString())
  //     allChanges.push(change)
  //   }
  //   allChanges.push(...indexChangesMap.values())
  //   const resourceDiffs = allChanges
  //     .map(change => getResourceDiffFromChange(change, version))
  //     .filter(diff => diff)
  //   return await filterOutExternalHiddenExcludedFiles(
  //     resourceDiffs,
  //     (diff: any) => (diff.right || diff.left).path,
  //   )
  // }

  // function getVersionFromCommitHash(commitHash: string | undefined) {
  //   if (!commitHash)
  //     return
  //   return {
  //     version: JSON.stringify({ ref: commitHash }),
  //     label: 'HEAD',
  //   }
  // }

  // function getResourceDiffFromChange(change: Change, version: string) {
  //   if (!change)
  //     return
  //   let left
  //   if (change.status !== Status.INDEX_ADDED) {
  //     left = {
  //       path: change.originalUri.path,
  //       type: SourceControlResourceType.WorkspaceWithSpecificVersion,
  //       version,
  //     }
  //   }
  //   const right = {
  //     path: change.uri.path,
  //     type: SourceControlResourceType.Workspace,
  //   }
  //   const changeType = change.status
  //   let title = basename(change.uri.fsPath)
  //   switch (change.status) {
  //     case Status.MODIFIED:
  //       title += ' (Modified)'
  //       break
  //     case Status.UNTRACKED:
  //     case Status.INDEX_ADDED:
  //       title += ' (Added)'
  //       break
  //     case Status.INDEX_RENAMED:
  //       title += ' (Renamed)'
  //       break
  //     case Status.DELETED:
  //       title += ' (Deleted)'
  //   }
  //   return { right, changeType, left, title }
  // }

  // async function getDiffForResource(uri: Uri, instanceId: string, groupId: ChangeGroupId) {
  //   if (!uri || !uri.path)
  //     return null
  //   const r = getRepoByInstanceId(instanceId)
  //   if (!r)
  //     return null
  //   const changes = {
  //     merge: r.state.mergeChanges,
  //     index: r.state.indexChanges,
  //     workingTree: r.state.workingTreeChanges,
  //   }[groupId]
  //   const change = changes.find((change) => {
  //     if (!change)
  //       return false
  //     const n = resourceFromUri(change.uri)
  //     return n && n.path === uri.path
  //   })
  //   if (!change)
  //     return null
  //   const s = change.uri
  //   let a, c, l
  //   try {
  //     a = await new Promise((e, t) =>
  //       u.fileAccess.lstat(s.fsPath, (n, r) => (n ? t(n) : e(r))),
  //     )
  //   }
  //   catch {}
  //   if (isDisposed)
  //     return null
  //   if (a && a.isDirectory()) {
  //     const e = getRepositoryForSubmodule(s)
  //     if (e) {
  //       const t = groupId === S ? 'index' : 'wt'
  //       const r = e.rootUri.fsPath
  //       l = resourceFromGitParams(s, t, r)
  //     }
  //   }
  //   else {
  //     if (change.status !== Status.ADDED_BY_US) {
  //       c = await getLeftResource(change)
  //     }
  //     l = await getRightResource(change)
  //   }
  //   if (!l || isDisposed)
  //     return null
  //   const d = getChangeType(change.status)
  //   return {
  //     left: c,
  //     right: l,
  //     title: getTitle(change),
  //     changeType: d,
  //   }
  // }

  // function getTitle(change: Change) {
  //   const filename = basename(change.uri.fsPath)
  //   switch (change.status) {
  //     case Status.INDEX_MODIFIED:
  //     case Status.INDEX_RENAMED:
  //       return `${filename} (Index)`
  //     case Status.MODIFIED:
  //     case Status.ADDED_BY_THEM:
  //     case Status.DELETED_BY_THEM:
  //       return `${filename} (Working Tree)`
  //     case Status.TYPE_CHANGED:
  //       return `${filename} (Theirs)`
  //     case Status.ADDED_BY_US:
  //       return `${filename} (Ours)`
  //     default:
  //       return ''
  //   }
  // }

  // async function getResourceFromGitParams(uri: Uri, ref: string) {
  //   const repo = getRepoContainingResource(uri)
  //   if (!repo)
  //     return resourceFromGitParams(uri, ref)
  //   try {
  //     let adjustedRef = ref
  //     if (adjustedRef === '~') {
  //       const uriString = uri.toString()
  //       const [indexChange] = repo.state.indexChanges.filter(
  //         (change: any) => change.uri && change.uri.toString() === uriString,
  //       )
  //       adjustedRef = indexChange ? '' : 'HEAD'
  //     }
  //     const { size, object: objectId } = await repo.getObjectDetails(
  //       adjustedRef,
  //       uri.fsPath,
  //     )
  //     const { mimetype } = await repo.detectObjectType(objectId)
  //     if (mimetype === 'text/plain')
  //       return resourceFromGitParams(uri, ref)
  //     if (size > 1e6) {
  //       return {
  //         type: SourceControlResourceType.External,
  //         path: `data:;label:${basename(uri.fsPath)};description:${adjustedRef},`,
  //       }
  //     }
  //     if ([
  //       'image/png',
  //       'image/gif',
  //       'image/jpeg',
  //       'image/webp',
  //       'image/tiff',
  //       'image/bmp',
  //     ].includes(mimetype)) {
  //       const buffer = await repo.buffer(adjustedRef, uri.fsPath)
  //       return {
  //         type: SourceControlResourceType.External,
  //         path: `data:${mimetype};label:${basename(uri.fsPath)};description:${adjustedRef};size:${size};base64,${buffer.toString('base64')}`,
  //       }
  //     }
  //     return {
  //       type: SourceControlResourceType.External,
  //       path: `data:;label:${basename(uri.fsPath)};description:${adjustedRef},`,
  //     }
  //   }
  //   catch {
  //     return resourceFromGitParams(uri, ref)
  //   }
  // }

  // async function getResource(resource: any) {
  //   if (!resource)
  //     return ''
  //   let {
  //     path: filePath,
  //     ref,
  //     submoduleOf,
  //   } = gitParamsFromResource(resource)
  //   if (submoduleOf) {
  //     const repo = getRepoContainingResource(submoduleOf)
  //     return repo
  //       ? ref === 'index'
  //         ? await repo.diffIndexWithHEAD(filePath)
  //         : await repo.diffWithHEAD(filePath)
  //       : ''
  //   }
  //   const repo
  //     = getRepoByInstanceId(resource.instanceId)
  //       || getRepoContainingResource(filePath)
  //   if (!repo)
  //     return ''
  //   const instanceId = getInstanceId(repo)
  //   const cacheEntry = {
  //     resource: { type: resource.type, path: resource.path, version: resource.version },
  //     timestamp: new Date().getTime(),
  //   }
  //   const cachedResources = resourceCache.get(instanceId)
  //   if ((cachedResources ? cachedResources.push(cacheEntry) : resourceCache.set(instanceId, [cacheEntry]), ref === '~')) {
  //     const uriString = l.Uri.file(filePath).toString()
  //     const [indexChange] = repo.state.indexChanges.filter(
  //       (change: any) => change && change.uri.toString() === uriString,
  //     )
  //     ref = indexChange ? '' : 'HEAD'
  //   }
  //   else if (/^~\d$/.test(ref)) {
  //     ref = `:${ref[1]}`
  //   }
  //   try {
  //     return await repo.show(ref, filePath)
  //   }
  //   catch {
  //     return ''
  //   }
  // }

  // function getRepoContainingResource(e: any) {
  //   if (
  //     e
  //     && (typeof e == 'string' && (e = l.Uri.file(e)), e instanceof l.Uri)
  //   ) {
  //     const t = e.fsPath
  //     // eslint-disable-next-line no-labels
  //     e: for (const repo of api.repositories.sort(
  //       (e, t) => e.rootUri.fsPath.length - t.rootUri.fsPath.length,
  //     )) {
  //       const n = repo.rootUri.fsPath
  //       if (isDescendant(n, t)) {
  //         for (const r of repo.state.submodules) {
  //           if (isDescendant(path.join(n, r.path), t))
  //             // eslint-disable-next-line no-labels
  //             continue e
  //         }
  //         return repo
  //       }
  //     }
  //   }
  // }

  // async function cleanResources(resources: any[]) {
  //   const instanceResourcesMap = new Map()
  //   for (const resource of resources) {
  //     if (!resource || !resource.instanceId)
  //       continue
  //     const instanceId = resource.instanceId
  //     const instanceResources = instanceResourcesMap.get(instanceId)
  //     instanceResources ? instanceResources.push(resource) : instanceResourcesMap.set(instanceId, [resource])
  //   }
  //   for (const [instanceId, resources] of instanceResourcesMap) {
  //     const repo = getRepoByInstanceId(instanceId)
  //     if (!repo)
  //       continue
  //     const filePaths = []
  //     for (const resource of resources) {
  //       const params = gitParamsFromResource(resource)
  //       params && params.path && filePaths.push(params.path)
  //     }
  //     await repo.clean(filePaths)
  //     if (isDisposed)
  //       return
  //   }
  // }

  // function cleanupDocumentUriCache() {
  //   const currentTime = new Date().getTime()
  //   for (const [instanceId, cachedResources] of resourceCache) {
  //     for (let i = cachedResources.length - 1; i >= 0; i--)
  //       currentTime - cachedResources[i].timestamp >= 18e4 && cachedResources.splice(i, 1)
  //     cachedResources.length || resourceCache.delete(instanceId)
  //   }
  // }

  // function resourceFromGitParams(uri: Uri | undefined, ref?: string, submoduleOf?: string) {
  //   if (uri) {
  //     if (ref === undefined && submoduleOf === undefined) {
  //       const uri_ = toHostUri(uri)
  //       return {
  //         type: SourceControlResourceType.Workspace,
  //         path: uri_.path,
  //       }
  //     }
  //     if (uri.scheme === 'file') {
  //       return {
  //         type: SourceControlResourceType.SpecificVersion,
  //         path: uri.fsPath,
  //         version: JSON.stringify({ ref, submoduleOf }),
  //       }
  //     }
  //   }
  // }

  // function gitParamsFromResource(resource: any) {
  //   if (!resource || !resource.path)
  //     return
  //   let filePath = resource.path
  //   switch (resource.type) {
  //     case SourceControlResourceType.SpecificVersion:
  //       break
  //     case SourceControlResourceType.Workspace:
  //     case SourceControlResourceType.WorkspaceWithSpecificVersion:
  //       filePath = converter.protocolUri2CodeUriConverter(
  //         Uri.parse(`${h.VSLS_SCHEME}:${filePath}`),
  //       ).fsPath
  //       break
  //     case SourceControlResourceType.External:
  //       if (filePath.startsWith('http:') || filePath.startsWith('https:'))
  //         return
  //       filePath = converter.protocolUri2CodeUriConverter(
  //         Uri.parse(
  //           filePath.startsWith(`${h.VSLS_SCHEME}:`)
  //             ? filePath
  //             : `${h.VSLS_SCHEME}:${filePath}`,
  //         ),
  //       ).fsPath
  //       break
  //     default:
  //       return
  //   }
  //   const versionData = resource.version ? JSON.parse(resource.version) : { ref: '' }
  //   versionData.path = filePath
  //   return versionData
  // }
}

// enum SourceControlResourceType {
//   Workspace = 0,
//   WorkspaceWithSpecificVersion = 1,
//   SpecificVersion = 2,
//   External = 3,
// }

// type ChangeGroupId = 'merge' | 'index' | 'workingTree'
