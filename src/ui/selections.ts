import type { DecorationOptions, TextEditor, TextEditorDecorationType } from 'vscode'
import type { UserColor } from './users'
import { computed, createSingletonComposable, ref, shallowRef, useCommands, useDisposable, watch, watchEffect } from 'reactive-vscode'
import { DecorationRangeBehavior, OverviewRulerLane, Selection, TextEditorRevealType, Uri, window } from 'vscode'
import { useActiveSession } from '../session'
import { useObserverShallow } from '../sync/doc'
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

  const { editor, selections } = useCoEditFriendlySelections()
  watch([map, selfId, editor, selections], () => {
    if (map.value && selfId.value) {
      const clientUri = editor.value && toTrackUri(editor.value.document.uri)
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

  const decorationTypes = new Map<string, {
    selection: TextEditorDecorationType
    nameTag: TextEditorDecorationType
  }>()
  function getDecorationTypes({ bg }: UserColor) {
    const old = decorationTypes.get(bg)
    if (old) {
      return old
    }
    const type = {
      selection: window.createTextEditorDecorationType({
        backgroundColor: withOpacity(bg, 0.35),
        borderRadius: '0.1rem',
        isWholeLine: false,
        rangeBehavior: DecorationRangeBehavior.ClosedOpen,
        overviewRulerLane: OverviewRulerLane.Full,
      }),
      nameTag: window.createTextEditorDecorationType({
        backgroundColor: bg,
        rangeBehavior: DecorationRangeBehavior.ClosedClosed,
        textDecoration: 'none; position: relative; z-index: 1;',
      }),
    }
    decorationTypes.set(bg, type)
    return type
  }

  const cleanupDecorations = new Map<string, (uri?: Uri) => void>()
  const mapVersion = useObserverShallow(map, (event) => {
    if (event.transaction.local) {
      return
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
  }, (map) => {
    for (const [peerId, info] of map) {
      updateDecorations(peerId, info)
    }
  })
  watchEffect(() => {
    if (!state.value) {
      for (const cleanup of cleanupDecorations.values()) {
        cleanup()
      }
      for (const { selection, nameTag } of decorationTypes.values()) {
        selection.dispose()
        nameTag.dispose()
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
      const { name, color } = getUserInfo(peerId)
      const types = getDecorationTypes(color)

      editor.setDecorations(types.selection, selections.map((s) => {
        const range = new Selection(...s)
        return {
          range,
          renderOptions: {
            [range.isReversed ? 'before' : 'after']: {
              contentText: 'ᛙ',
              margin: `0px 0px 0px -${range.active.character === 0 ? '0.17' : '0.25'}ch`,
              color: color.bg,
              textDecoration: `none; ${stringifyCssProperties({
                'position': 'absolute',
                'display': 'inline-block',
                'top': '0',
                'font-size': '200%',
                'font-weight': 'bold',
                'z-index': 1,
              })}`,
            },
          },
        } satisfies DecorationOptions
      }))
      if (selections.length > 0) {
        const range0 = new Selection(...selections[0])
        editor.setDecorations(types.nameTag, [{
          range: new Selection(range0.active, range0.active),
          renderOptions: {
            after: {
              contentText: name,
              backgroundColor: color.bg,
              textDecoration: `none; ${stringifyCssProperties({
                'position': 'absolute',
                'top': `${range0.active.line > 0 ? -1 : 1}rem`,
                'border-radius': '0.15rem',
                'padding': '0px 0.5ch',
                'display': 'inline-block',
                'pointer-events': 'none',
                'color': color.fg,
                'font-size': '0.7rem',
                'z-index': 1,
                'font-weight': 'bold',
              })}`,
            },
          },
        }])
      }

      cleanupDecorations.set(peerId, (uri) => {
        if (uri?.toString() === uri_.toString()) {
          // Avoid flicker by setting empty decorations
          return
        }
        editor.setDecorations(types.selection, [])
        editor.setDecorations(types.nameTag, [])
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
  watchEffect(() => {
    if (following.value) {
      const selection = getSelection(following.value)
      if (selection) {
        gotoSelection(selection)
      }
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

function useCoEditFriendlySelections() {
  const editor = shallowRef<TextEditor | undefined>(window.activeTextEditor)
  const selections = shallowRef<readonly Selection[]>(editor.value?.selections ?? [])
  let delayedTimeout: any | null = null

  useDisposable(window.onDidChangeTextEditorSelection((ev) => {
    if (delayedTimeout != null) {
      clearTimeout(delayedTimeout)
    }
    if (ev.kind !== undefined || ev.textEditor !== editor.value) {
      editor.value = ev.textEditor
      selections.value = ev.selections
    }
    else {
      delayedTimeout = setTimeout(() => {
        selections.value = ev.selections
        delayedTimeout = null
      }, 1000)
    }
  }))

  return { editor, selections }
}
