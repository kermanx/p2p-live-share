import type { ComputedRef, Ref } from 'reactive-vscode'
import type { DecorationOptions, TextEditor, TextEditorDecorationType } from 'vscode'
import type * as Y from 'yjs'
import type { UserColor } from './users'
import { computed, createSingletonComposable, ref, shallowRef, useCommands, useDisposable, useVisibleTextEditors, watch, watchEffect } from 'reactive-vscode'
import { DecorationRangeBehavior, OverviewRulerLane, Selection, TextEditorRevealType, Uri, window } from 'vscode'
import { useActiveSession } from '../session'
import { useShallowYMapScopes } from '../sync/doc'
import { withOpacity } from './colors'
import { useUsers } from './users'

interface SelectionInfo {
  uri: string
  selections: ConstructorParameters<typeof Selection>[]
}

export const useSelections = createSingletonComposable(() => {
  const { doc, selfId, toTrackUri, toLocalUri } = useActiveSession()
  const { getUserInfo } = useUsers()

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

  const visibleTextEditors = useVisibleTextEditors()
  const currentSelection = useRealtimeSelections()
  const mapVersion = useShallowYMapScopes(map, (peerId, { uri, selections }) => {
    if (peerId === selfId.value) {
      return
    }

    const uri_ = toLocalUri(Uri.parse(uri))
    const editor = computed(() => visibleTextEditors.value.find(e => e.document.uri.toString() === uri_.toString()))
    const types = useDecorationTypes(computed(() => getUserInfo(peerId).color))
    watchEffect(() => {
      const { color } = getUserInfo(peerId)
      editor.value?.setDecorations(types.value.selection, selections.map((s) => {
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
    })

    watchEffect(() => {
      if (!editor.value || selections.length === 0) {
        return
      }

      const { name, color } = getUserInfo(peerId)
      const { active } = new Selection(...selections[0])

      const isFirstLine = active.line === 0
      const isActiveLineAbove = currentSelection.editor.value === editor.value
        && currentSelection.selections.value.some(s => s.active.line === active.line - 1)
      const belowText = isFirstLine || isActiveLineAbove

      editor.value.setDecorations(types.value.nameTag, [{
        range: new Selection(active, active),
        renderOptions: {
          after: {
            contentText: name,
            backgroundColor: color.bg,
            textDecoration: `none; ${stringifyCssProperties({
              'position': 'absolute',
              'top': `calc(${belowText ? 1 : -1} * var(--vscode-editorCodeLens-lineHeight))`,
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
    })
  })

  return useFollowing(map, mapVersion)
})

function stringifyCssProperties(e: Record<string, string | number>) {
  return Object.keys(e)
    .map(t => `${t}: ${e[t]};`)
    .join(' ')
}

function useDecorationTypes(color: ComputedRef<UserColor>) {
  const types = shallowRef<{
    selection: TextEditorDecorationType
    nameTag: TextEditorDecorationType
  }>(null!)
  watchEffect((onCleanup) => {
    const types_ = types.value = {
      selection: window.createTextEditorDecorationType({
        backgroundColor: withOpacity(color.value.bg, 0.35),
        borderRadius: '0.1rem',
        isWholeLine: false,
        rangeBehavior: DecorationRangeBehavior.ClosedOpen,
        overviewRulerLane: OverviewRulerLane.Full,
      }),
      nameTag: window.createTextEditorDecorationType({
        backgroundColor: color.value.bg,
        rangeBehavior: DecorationRangeBehavior.ClosedClosed,
        textDecoration: 'none; position: relative; z-index: 1;',
      }),
    }
    onCleanup(() => {
      types_.selection.dispose()
      types_.nameTag.dispose()
    })
  })
  return types
}

const useRealtimeSelections = createSingletonComposable(() => {
  const editor = shallowRef<TextEditor | undefined>(window.activeTextEditor)
  const selections = shallowRef<readonly Selection[]>(editor.value?.selections ?? [])
  useDisposable(window.onDidChangeTextEditorSelection((ev) => {
    editor.value = ev.textEditor
    selections.value = ev.selections
  }))
  return { editor, selections }
})

const useCoEditFriendlySelections = createSingletonComposable(() => {
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
})

function useFollowing(map: ComputedRef<Y.Map<SelectionInfo> | undefined>, mapVersion: Ref<number>) {
  function getSelection(peerId: string) {
    void mapVersion.value
    return map.value?.get(peerId)
  }

  const { toLocalUri } = useActiveSession()
  const { pickPeerId } = useUsers()

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

  return { getSelection, following }
}
