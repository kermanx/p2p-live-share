import type { BirpcReturn } from 'birpc'
import type { SourceControlResourceGroup, SourceControlResourceState } from 'vscode'
import type * as Y from 'yjs'
import type { ClientFunctions, HostFunctions } from '../rpc/types'
import type { GitExtension } from './git'
import type { ScmChange, ScmGroupMeta, ScmRepo } from './types'
import { basename } from 'pathe'
import { useCommands, useDisposable, watchEffect } from 'reactive-vscode'
import { extensions, l10n, scm, ThemeColor, Uri, window, workspace } from 'vscode'
import { useShallowYArray, useShallowYMapScopes } from '../sync/doc'
import { lazy } from '../utils'
import { Status } from './git'

export function useClientScm(doc: Y.Doc, rpc: BirpcReturn<HostFunctions, ClientFunctions>) {
  const map = doc.getMap<ScmRepo>('scm')

  useShallowYMapScopes(() => map, useScmRepo)

  useCommands({
    'p2p-live-share.scm.cleanAll': async (group: SourceControlResourceGroup) => {
      const states = (group.resourceStates as ReturnType<typeof createResourceState>[])
        .filter(({ groupMeta }) => groupMeta && groupMeta.supportsClean)
      if (!states.length) {
        return
      }

      const t = states.filter(({ status }) => status === Status.UNTRACKED).length
      let message
      let action = 'Discard Changes'

      if (states.length === 1) {
        if (t > 0) {
          message = `Are you sure you want to DELETE ${basename(states[0].resourceUri.fsPath)}?`
          action = 'Delete file'
        }
        else if (states[0].status === Status.DELETED) {
          action = 'Restore file'
          message = `Are you sure you want to restore ${basename(states[0].resourceUri.fsPath)}?`
        }
        else {
          message = `Are you sure you want to discard changes in ${basename(states[0].resourceUri.fsPath)}?`
        }
      }
      else {
        if (states.every(({ status }) => status === Status.DELETED)) {
          action = 'Restore files'
          message = `Are you sure you want to restore ${states.length} files?`
        }
        else {
          message = `Are you sure you want to discard changes in ${states.length} files?`
        }
        if (t > 0) {
          message = `${message}\n\nThis will DELETE ${t} untracked files!`
        }
      }
      if ((await window.showWarningMessage(message, { modal: true }, action)) === action) {
        await rpc.scmClean(
          states[0].repoUri,
          states[0].groupMeta.groupId,
          states.map(({ resourceUri }) => resourceUri.toString()),
        )
      }
    },
  })

  //   async function getDiscardUntrackedChangesDialogDetails(resources: SourceControlResourceState[]): Promise<[string, string, string]> {
  //     const isWindows = useActiveSession()!.hostMeta.value!.os === 'win32'
  //     const discardUntrackedChangesToTrash = await rpc.scmShouldDiscardUntrackedChangesToTrash()

  //     const messageWarning = !discardUntrackedChangesToTrash
  //       ? resources.length === 1
  //         ? `\n\n${l10n.t('This is IRREVERSIBLE!\nThis file will be FOREVER LOST if you proceed.')}`
  //         : `\n\n${l10n.t('This is IRREVERSIBLE!\nThese files will be FOREVER LOST if you proceed.')}`
  //       : ''

  //     const message = resources.length === 1
  //       ? l10n.t('Are you sure you want to DELETE the following untracked file: \'{0}\'?{1}', basename(resources[0].resourceUri.fsPath), messageWarning)
  //       : l10n.t('Are you sure you want to DELETE the {0} untracked files?{1}', resources.length, messageWarning)

  //     const messageDetail = discardUntrackedChangesToTrash
  //       ? isWindows
  //         ? resources.length === 1
  //           ? l10n.t('You can restore this file from the Recycle Bin.')
  //           : l10n.t('You can restore these files from the Recycle Bin.')
  //         : resources.length === 1
  //           ? l10n.t('You can restore this file from the Trash.')
  //           : l10n.t('You can restore these files from the Trash.')
  //       : ''

  //     const primaryAction = discardUntrackedChangesToTrash
  //       ? isWindows
  //         ? l10n.t('Move to Recycle Bin')
  //         : l10n.t('Move to Trash')
  //       : resources.length === 1
  //         ? l10n.t('Delete File')
  //         : l10n.t('Delete All {0} Files', resources.length)

//     return [message, messageDetail, primaryAction]
//   }
}

function useScmRepo(uri: string, repo: ScmRepo) {
  const [groups, meta] = repo.toArray()
  const sc = useDisposable(scm.createSourceControl('p2p-live-share-scm', meta.label, Uri.parse(meta.rootUri)))
  sc.inputBox.visible = false
  useShallowYMapScopes(
    () => groups,
    (id, data) => {
      const [changes, meta] = data.toArray()

      const group = useDisposable(sc.createResourceGroup(createGroupId(meta), l10n.t(meta.label)))
      group.hideWhenEmpty = meta.hideWhenEmpty

      const states = useShallowYArray(() => changes)
      watchEffect(() => {
        group.resourceStates = states.value.map(state => createResourceState(state, meta, uri))
      })
    },
  )
  // sc.quickDiffProvider = {
  //   provideOriginalResource(uri, token) {

  //   },
  // }

  function createGroupId(meta: ScmGroupMeta) {
    let groupId = meta.groupId
    if (meta.supportsClean) {
      groupId += '(clean)'
    }
    if (meta.supportsOpenChanges) {
      groupId += '(openChanges)'
    }
    if (meta.supportsOpenFile) {
      groupId += '(openFile)'
    }
    return groupId
  }
}

function createResourceState({ uri, status }: ScmChange, meta: ScmGroupMeta, repoUri: string) {
  const useIcons = !areGitDecorationsEnabled()
  return {
    resourceUri: Uri.parse(uri),
    command: {
      command: 'p2p-live-share.openScmChange',
      title: 'Open',
      arguments: [meta.groupId, uri],
    },
    decorations: {
      strikeThrough: getStrikeThrough(),
      faded: false,
      tooltip: getTooltip(),
      light: useIcons
        ? { iconPath: getIconPath('light') }
        : undefined,
      dark: useIcons
        ? { iconPath: getIconPath('dark') }
        : undefined,
    },
    letter: getLetter(),
    color: getColor(),
    priority: getPriority(),
    // resourceDecoration

    repoUri,
    status,
    groupMeta: meta,
  } satisfies SourceControlResourceState & Record<string, unknown>

  function getIconPath(theme: 'light' | 'dark'): Uri | undefined {
    const Icons = getAllIcons()
    if (!Icons) {
      return undefined
    }
    switch (status) {
      case Status.INDEX_MODIFIED: return Icons[theme].Modified
      case Status.MODIFIED: return Icons[theme].Modified
      case Status.INDEX_ADDED: return Icons[theme].Added
      case Status.INDEX_DELETED: return Icons[theme].Deleted
      case Status.DELETED: return Icons[theme].Deleted
      case Status.INDEX_RENAMED: return Icons[theme].Renamed
      case Status.INDEX_COPIED: return Icons[theme].Copied
      case Status.UNTRACKED: return Icons[theme].Untracked
      case Status.IGNORED: return Icons[theme].Ignored
      case Status.INTENT_TO_ADD: return Icons[theme].Added
      case Status.INTENT_TO_RENAME: return Icons[theme].Renamed
      case Status.TYPE_CHANGED: return Icons[theme].TypeChanged
      case Status.BOTH_DELETED: return Icons[theme].Conflict
      case Status.ADDED_BY_US: return Icons[theme].Conflict
      case Status.DELETED_BY_THEM: return Icons[theme].Conflict
      case Status.ADDED_BY_THEM: return Icons[theme].Conflict
      case Status.DELETED_BY_US: return Icons[theme].Conflict
      case Status.BOTH_ADDED: return Icons[theme].Conflict
      case Status.BOTH_MODIFIED: return Icons[theme].Conflict
    }
  }

  function getPriority(): number {
    switch (status) {
      case Status.INDEX_MODIFIED:
      case Status.MODIFIED:
      case Status.INDEX_COPIED:
      case Status.TYPE_CHANGED:
        return 2
      case Status.IGNORED:
        return 3
      case Status.BOTH_DELETED:
      case Status.ADDED_BY_US:
      case Status.DELETED_BY_THEM:
      case Status.ADDED_BY_THEM:
      case Status.DELETED_BY_US:
      case Status.BOTH_ADDED:
      case Status.BOTH_MODIFIED:
        return 4
      default:
        return 1
    }
  }

  function getTooltip() {
    switch (status) {
      case Status.INDEX_MODIFIED: return l10n.t('Index Modified')
      case Status.MODIFIED: return l10n.t('Modified')
      case Status.INDEX_ADDED: return l10n.t('Index Added')
      case Status.INDEX_DELETED: return l10n.t('Index Deleted')
      case Status.DELETED: return l10n.t('Deleted')
      case Status.INDEX_RENAMED: return l10n.t('Index Renamed')
      case Status.INDEX_COPIED: return l10n.t('Index Copied')
      case Status.UNTRACKED: return l10n.t('Untracked')
      case Status.IGNORED: return l10n.t('Ignored')
      case Status.INTENT_TO_ADD: return l10n.t('Intent to Add')
      case Status.INTENT_TO_RENAME: return l10n.t('Intent to Rename')
      case Status.TYPE_CHANGED: return l10n.t('Type Changed')
      case Status.BOTH_DELETED: return l10n.t('Conflict: Both Deleted')
      case Status.ADDED_BY_US: return l10n.t('Conflict: Added By Us')
      case Status.DELETED_BY_THEM: return l10n.t('Conflict: Deleted By Them')
      case Status.ADDED_BY_THEM: return l10n.t('Conflict: Added By Them')
      case Status.DELETED_BY_US: return l10n.t('Conflict: Deleted By Us')
      case Status.BOTH_ADDED: return l10n.t('Conflict: Both Added')
      case Status.BOTH_MODIFIED: return l10n.t('Conflict: Both Modified')
      default: return ''
    }
  }

  function getLetter() {
    switch (status) {
      case Status.INDEX_MODIFIED:
      case Status.MODIFIED:
        return 'M'
      case Status.INDEX_ADDED:
      case Status.INTENT_TO_ADD:
        return 'A'
      case Status.INDEX_DELETED:
      case Status.DELETED:
        return 'D'
      case Status.INDEX_RENAMED:
      case Status.INTENT_TO_RENAME:
        return 'R'
      case Status.TYPE_CHANGED:
        return 'T'
      case Status.UNTRACKED:
        return 'U'
      case Status.IGNORED:
        return 'I'
      case Status.INDEX_COPIED:
        return 'C'
      case Status.BOTH_DELETED:
      case Status.ADDED_BY_US:
      case Status.DELETED_BY_THEM:
      case Status.ADDED_BY_THEM:
      case Status.DELETED_BY_US:
      case Status.BOTH_ADDED:
      case Status.BOTH_MODIFIED:
        return '!' // Using ! instead of ⚠, because the latter looks really bad on windows
    }
  }

  function getColor() {
    switch (status) {
      case Status.INDEX_MODIFIED:
        return new ThemeColor('gitDecoration.stageModifiedResourceForeground')
      case Status.MODIFIED:
      case Status.TYPE_CHANGED:
        return new ThemeColor('gitDecoration.modifiedResourceForeground')
      case Status.INDEX_DELETED:
        return new ThemeColor('gitDecoration.stageDeletedResourceForeground')
      case Status.DELETED:
        return new ThemeColor('gitDecoration.deletedResourceForeground')
      case Status.INDEX_ADDED:
      case Status.INTENT_TO_ADD:
        return new ThemeColor('gitDecoration.addedResourceForeground')
      case Status.INDEX_COPIED:
      case Status.INDEX_RENAMED:
      case Status.INTENT_TO_RENAME:
        return new ThemeColor('gitDecoration.renamedResourceForeground')
      case Status.UNTRACKED:
        return new ThemeColor('gitDecoration.untrackedResourceForeground')
      case Status.IGNORED:
        return new ThemeColor('gitDecoration.ignoredResourceForeground')
      case Status.BOTH_DELETED:
      case Status.ADDED_BY_US:
      case Status.DELETED_BY_THEM:
      case Status.ADDED_BY_THEM:
      case Status.DELETED_BY_US:
      case Status.BOTH_ADDED:
      case Status.BOTH_MODIFIED:
        return new ThemeColor('gitDecoration.conflictingResourceForeground')
    }
  }

  function getStrikeThrough() {
    switch (status) {
      case Status.DELETED:
      case Status.BOTH_DELETED:
      case Status.DELETED_BY_THEM:
      case Status.DELETED_BY_US:
      case Status.INDEX_DELETED:
        return true
      default:
        return false
    }
  }
}

const areGitDecorationsEnabled = lazy(() => {
  return workspace
    .getConfiguration('git')
    .get('decorations.enabled', true)
})

const getAllIcons = lazy(() => {
  const gitExtension = extensions.getExtension<GitExtension>('vscode.git')
  if (!gitExtension) {
    return null
  }
  const iconsRootPath = Uri.joinPath(gitExtension.extensionUri, 'resources', 'icons')
  function getIconUri(iconName: string, theme: string): Uri {
    return Uri.joinPath(iconsRootPath, theme, `${iconName}.svg`)
  }

  return {
    light: {
      Modified: getIconUri('status-modified', 'light'),
      Added: getIconUri('status-added', 'light'),
      Deleted: getIconUri('status-deleted', 'light'),
      Renamed: getIconUri('status-renamed', 'light'),
      Copied: getIconUri('status-copied', 'light'),
      Untracked: getIconUri('status-untracked', 'light'),
      Ignored: getIconUri('status-ignored', 'light'),
      Conflict: getIconUri('status-conflict', 'light'),
      TypeChanged: getIconUri('status-type-changed', 'light'),
    },
    dark: {
      Modified: getIconUri('status-modified', 'dark'),
      Added: getIconUri('status-added', 'dark'),
      Deleted: getIconUri('status-deleted', 'dark'),
      Renamed: getIconUri('status-renamed', 'dark'),
      Copied: getIconUri('status-copied', 'dark'),
      Untracked: getIconUri('status-untracked', 'dark'),
      Ignored: getIconUri('status-ignored', 'dark'),
      Conflict: getIconUri('status-conflict', 'dark'),
      TypeChanged: getIconUri('status-type-changed', 'dark'),
    },
  }
})
