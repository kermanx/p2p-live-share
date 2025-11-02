import type { DecorationOptions, TextEditorDecorationType } from 'vscode'
import type { UserColor } from './users'
import { computed, createSingletonComposable, ref, useActiveTextEditor, useCommands, useDisposable, useTextEditorSelections, watch, watchEffect } from 'reactive-vscode'
import { DecorationRangeBehavior, OverviewRulerLane, Selection, TextEditorRevealType, Uri, window } from 'vscode'
import { useActiveSession } from '../session'
import { useObserverDeep } from '../sync/doc'
import { withOpacity } from './colors'
import { useUsers } from './users'

interface SelectionInfo {
  uri: string
  selections: ConstructorParameters<typeof Selection>[]
}

export const useSelections = createSingletonComposable(() => {
  const { state, doc, selfId, toTrackUri, toLocalUri } = useActiveSession()
  const { getUserInfo, pickPeerId } = useUsers()

  const map = computed(() => doc.value?.getMap<SelectionInfo>('selections'))

  const activeTextEditor = useActiveTextEditor()
  const selections = useTextEditorSelections(activeTextEditor)
  watch([map, selfId, activeTextEditor, selections], () => {
    if (map.value && selfId.value) {
      const clientUri = activeTextEditor.value && toTrackUri(activeTextEditor.value.document.uri)
      if (clientUri) {
        map.value.set(selfId.value, {
          uri: clientUri.toString(),
          selections: selections.value.map(selection => [
            selection.anchor.line,
            selection.anchor.character,
            selection.active.line,
            selection.active.character,
          ]),
        })
      }
      else {
        map.value.delete(selfId.value)
      }
    }
  }, { immediate: true })

  const injectedStyles = stringifyCssProperties({
    'position': 'absolute',
    'display': 'inline-block',
    'top': '0',
    'font-size': '200%',
    'font-weight': 'bold',
    'z-index': 1,
  })
  const decorationTypes = new Map<string, TextEditorDecorationType>()
  function getDecorationType({ bg }: UserColor) {
    const old = decorationTypes.get(bg)
    if (old) {
      return old
    }
    const type = window.createTextEditorDecorationType({
      backgroundColor: withOpacity(bg, 0.35),
      borderRadius: '0.1rem',
      isWholeLine: false,
      rangeBehavior: DecorationRangeBehavior.ClosedOpen,
      overviewRulerLane: OverviewRulerLane.Full,
    })
    decorationTypes.set(bg, type)
    return type
  }

  const cleanupDecorations = new Map<string, (uri?: Uri) => void>()
  const mapVersion = useObserverDeep(
    map,
    (events) => {
      for (const event of events) {
        if (event.transaction.local) {
          continue
        }

        for (const [peerId, { action }] of event.keys) {
          if (action === 'delete') {
            cleanupDecorations.get(peerId)?.()
            // Should dispose decoration type?
          }
          else {
            updateDecorations(peerId)
          }
        }
      }
    },
    (map) => {
      for (const [peerId, info] of map) {
        updateDecorations(peerId, info)
      }
    },
  )
  watchEffect(() => {
    if (!state.value) {
      for (const cleanup of cleanupDecorations.values()) {
        cleanup()
      }
      for (const type of decorationTypes.values()) {
        type.dispose()
      }
    }
  })

  const invisiblePeers = new Set<string>()
  function updateDecorations(peerId: string, info?: SelectionInfo) {
    if (peerId === selfId.value) {
      return
    }
    const { uri, selections } = info ?? map.value!.get(peerId)!

    const uri_ = toLocalUri(Uri.parse(uri))
    const editor = window.visibleTextEditors.find(e => e.document.uri.toString() === uri_.toString())
    cleanupDecorations.get(peerId)?.(uri_)
    if (editor) {
      const { color } = getUserInfo(peerId)
      const selectionDecoration = getDecorationType(color)
      const makeRange = (s: typeof selections[0]) => {
        const range = new Selection(...s)
        return {
          range,
          renderOptions: {
            [range.isReversed ? 'before' : 'after']: {
              contentText: 'ᛙ',
              margin: `0px 0px 0px -${range.active.character === 0 ? '0.17' : '0.25'}ch`,
              color: color.bg,
              textDecoration: `none; ${injectedStyles}`,
            },
          },
        } satisfies DecorationOptions
      }
      editor.setDecorations(selectionDecoration, selections.map(makeRange))
      cleanupDecorations.set(peerId, (uri) => {
        if (uri?.toString() === uri_.toString()) {
          // Avoid flicker by setting empty decorations
          return
        }
        editor.setDecorations(selectionDecoration, [])
        cleanupDecorations.delete(peerId)
        invisiblePeers.delete(peerId)
      })
      invisiblePeers.delete(peerId)
    }
    else {
      invisiblePeers.add(peerId)
    }
  }

  useDisposable(window.onDidChangeVisibleTextEditors(() => {
    for (const peerId of invisiblePeers) {
      updateDecorations(peerId)
    }
  }))

  function getSelection(peerId: string) {
    void mapVersion.value
    return map.value?.get(peerId)
  }

  function gotoSelection(info: SelectionInfo) {
    const localUri = toLocalUri(Uri.parse(info.uri))
    const selection = info.selections[0]
    window.showTextDocument(localUri, { preserveFocus: true }).then((editor) => {
      if (selection) {
        editor.revealRange(new Selection(...selection), TextEditorRevealType.Default)
      }
    })
  }

  const following = ref<string | null>(null)
  const followingSelection = computed(() => {
    if (following.value) {
      return getSelection(following.value)
    }
    return null
  })
  watchEffect(() => {
    if (followingSelection.value) {
      gotoSelection(followingSelection.value)
    }
  })

  useCommands({
    'p2p-live-share.focusParticipant': async (peerId?: string) => {
      peerId ||= await pickPeerId()
      if (peerId) {
        const info = getSelection(peerId)
        if (!info) {
          window.showInformationMessage('Cannot find selections for the user.')
          return
        }
        gotoSelection(info)
      }
    },
    'p2p-live-share.followParticipant': async (item: any) => {
      const peerId = item?.treeItem?.peerId || await pickPeerId()
      if (peerId) {
        following.value = peerId
      }
    },
    'p2p-live-share.unfollowParticipant': () => {
      following.value = null
    },
  })

  return {
    getSelection,
    following,
  }
})

function stringifyCssProperties(e: Record<string, string | number>) {
  return Object.keys(e)
    .map(t => `${t}: ${e[t]};`)
    .join(' ')
}
