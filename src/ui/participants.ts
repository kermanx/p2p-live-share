import type { TreeViewNode } from 'reactive-vscode'
import { computed, createSingletonComposable, ref, useTreeView } from 'reactive-vscode'
import { ThemeColor, ThemeIcon, Uri } from 'vscode'
import { useActiveSession } from '../session'
import { useSelections } from './selections'
import { useUsers } from './users'

export const useParticipantsTree = createSingletonComposable(() => {
  const { peers, getUserInfo } = useUsers()
  const { getSelection, following } = useSelections()
  const { toLocalUri, hostId, connection } = useActiveSession()

  const pings = ref<Record<string, number>>({})
  setInterval(() => {
    if (!peers.value || !connection.value) {
      pings.value = {}
      return
    }
    for (const peerId of peers.value) {
      connection.value.ping(peerId).then((time) => {
        pings.value[peerId] = time
      })
    }
  }, 5000)

  const orderedPeers = computed(() => {
    return (peers.value || []).slice().sort((a, b) => {
      if (a === hostId.value)
        return -1
      if (b === hostId.value)
        return 1
      return getUserInfo(a).name.localeCompare(getUserInfo(b).name)
    })
  })

  useTreeView(
    'p2p-live-share.participants',
    () => orderedPeers.value.map<TreeViewNode>((peerId) => {
      const user = getUserInfo(peerId)
      const selections = getSelection(peerId)

      let tooltip = user.name
      const isFollowing = following.value === peerId
      if (selections) {
        const path = toLocalUri(Uri.parse(selections.uri)).fsPath
        const line = selections.selections[0]?.[3] + 1
        tooltip += ` • ${path}:${line}`
        if (isFollowing) {
          tooltip += ' (Following)'
        }
      }

      let description = `${pings.value[peerId] ?? '-'}ms `
      if (peerId === hostId.value) {
        description += ' (Host)'
      }
      if (isFollowing) {
        description += ' (Following)'
      }

      return {
        treeItem: {
          iconPath: new ThemeIcon(isFollowing ? 'circle-filled' : 'circle', new ThemeColor(user.color.id)),
          label: user?.name ?? 'Unknown',
          description,
          tooltip,
          contextValue: isFollowing ? 'following' : 'not-following',
          command: {
            title: 'Focus Participant',
            command: 'p2p-live-share.focusParticipant',
            arguments: [peerId],
          },
          peerId,
        },
      }
    }),
  )
})
