import type { ComputedRef, Ref } from 'reactive-vscode'
import type { DecorationOptions, TextEditor, TextEditorDecorationType } from 'vscode'
import type * as Y from 'yjs'
import { computed, createSingletonComposable, onScopeDispose, ref, shallowRef, useCommands, useDisposable, useVisibleTextEditors, watch, watchEffect } from 'reactive-vscode'
import { DecorationRangeBehavior, OverviewRulerLane, Selection, TextEditorRevealType, Uri, window } from 'vscode'
import { useActiveSession } from '../session'
import { useShallowYMapKeyScopes } from '../sync/doc'
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

  const { editor, selections: selfCoEditSelections } = useCoEditFriendlySelections()
  watch([map, selfId, editor, selfCoEditSelections], () => {
    if (map.value && selfId.value) {
      const clientUri = editor.value && toTrackUri(editor.value.document.uri)
      if (clientUri) {
        map.value.set(selfId.value, {
          uri: clientUri.toString(),
          selections: selfCoEditSelections.value.map(selection => [
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
  onScopeDispose(() => {
    if (map.value && selfId.value) {
      map.value.delete(selfId.value)
    }
  })

  const visibleTextEditors = useVisibleTextEditors()
  const selfRealtimeSelections = useRealtimeSelections()
  const mapVersion = useShallowYMapKeyScopes(map, (peerId, info) => {
    if (peerId === selfId.value) {
      return
    }

    const uri = computed(() => toLocalUri(Uri.parse(info.value.uri)))
    const selections = computed(() => info.value.selections)
    const editor = computed(() => visibleTextEditors.value.find(e => e.document.uri.toString() === uri.value.toString()))
    const color = computed(() => getUserInfo(peerId).color)

    // Selection decorations
    const selectionType = shallowRef<TextEditorDecorationType>(null!)
    watchEffect((onCleanup) => {
      const type = selectionType.value = window.createTextEditorDecorationType({
        backgroundColor: withOpacity(color.value.bg, 0.35),
        borderRadius: '0.1rem',
        isWholeLine: false,
        rangeBehavior: DecorationRangeBehavior.ClosedOpen,
        overviewRulerLane: OverviewRulerLane.Full,
      })
      onCleanup(() => type.dispose())
    })
    watchEffect((onCleanup) => {
      const e = editor.value
      if (!e) {
        return
      }
      const { color } = getUserInfo(peerId)
      e.setDecorations(selectionType.value, info.value.selections.map((s) => {
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
      onCleanup(() => {
        if (e !== editor.value) {
          e.setDecorations(selectionType.value, [])
        }
      })
    })

    // Name tag decorations
    const nameTagType = shallowRef<TextEditorDecorationType>(null!)
    watchEffect((onCleanup) => {
      const type = nameTagType.value = window.createTextEditorDecorationType({
        backgroundColor: color.value.bg,
        rangeBehavior: DecorationRangeBehavior.ClosedClosed,
        textDecoration: 'none; position: relative; z-index: 1;',
      })
      onCleanup(() => type.dispose())
    })
    const activePosition = computed(() => (new Selection(...selections.value[selections.value.length - 1])).active)
    const isFirstLine = computed(() => activePosition.value.line === 0)
    const isSameEditor = computed(() => editor.value && editor.value === selfRealtimeSelections.editor.value)
    const isEditingAbove = computed(() => isSameEditor.value && selfRealtimeSelections.selections.value.some(s => s.active.line === activePosition.value.line - 1))
    const isEditingBelow = computed(() => isSameEditor.value && selfRealtimeSelections.selections.value.some(s => s.active.line === activePosition.value.line + 1))
    const hideNameTag = computed(() => isFirstLine.value && isEditingBelow.value)
    const belowText = computed(() => isFirstLine.value || isEditingAbove.value)
    watchEffect((onCleanup) => {
      const e = editor.value
      if (!e || selections.value.length === 0) {
        return
      }
      if (hideNameTag.value) {
        e.setDecorations(nameTagType.value, [])
        return
      }
      const { name, color } = getUserInfo(peerId)
      e.setDecorations(nameTagType.value, [{
        range: new Selection(activePosition.value, activePosition.value),
        renderOptions: {
          before: {
            contentText: name,
            backgroundColor: color.bg,
            textDecoration: `none; ${stringifyCssProperties({
              'position': 'absolute',
              'top': `calc(${belowText.value ? 1 : -1} * var(--vscode-editorCodeLens-lineHeight))`,
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
      onCleanup(() => {
        if (e !== editor.value) {
          e.setDecorations(nameTagType.value, [])
        }
      })
    })
  })

  return useFollowing(map, mapVersion)
})

function stringifyCssProperties(e: Record<string, string | number>) {
  return Object.keys(e)
    .map(t => `${t}: ${e[t]};`)
    .join(' ')
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
    const selection = info.selections[info.selections.length - 1]
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
