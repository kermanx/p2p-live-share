import { computed, createSingletonComposable, onScopeDispose, ref, watch } from 'reactive-vscode'
import { authentication, ConfigurationTarget, window } from 'vscode'
import { configs } from '../configs'
import { useActiveSession } from '../session'
import { useObserverDeep } from '../sync/doc'
import { createColorAllocator, TransparentColor } from './colors'

export interface UserColor {
  id: string
  fg: string
  bg: string
}

export interface UserInfo {
  name: string
  avatarUrl: string | null
  color: UserColor | null
}

export const useUsers = createSingletonComposable(() => {
  const { role, doc, selfId, peers, state } = useActiveSession()

  const map = computed(() => doc.value?.getMap<UserInfo>('users'))

  const colorAllocator = createColorAllocator()
  const userName = ref<string | null>(null)
  const avatarUrl = ref<string | null>(null)

  const mapVersion = useObserverDeep(
    map,
    (events) => {
      for (const event of events) {
        for (const [peerId, { action, oldValue }] of event.keys) {
          if (action === 'add') {
            const user = event.target.get(peerId) as UserInfo

            if (role.value === 'host') {
              const color = colorAllocator.alloc(peerId)
              event.target.set(peerId, {
                ...user,
                color: {
                  id: `p2pliveshare.participant.${color[0]}`,
                  fg: color[1],
                  bg: color[2],
                },
              })
            }

            if (peerId !== selfId.value) {
              window.showInformationMessage(`${user.name} joined the session.`)
            }
          }
          else if (action === 'delete') {
            if (role.value === 'host') {
              colorAllocator.free(peerId)
            }

            if (peerId !== selfId.value) {
              window.showInformationMessage(`${oldValue.name} left the session.`)
            }
          }
        }
      }
    },
    () => {},
  )

  async function inquireUserName(isHost: boolean) {
    return userName.value = await worker()
    async function worker() {
      if (configs.userName) {
        return configs.userName
      }
      if (userName.value) {
        return userName.value
      }

      const occupied = new Set(map.value?.keys())
      function toFreeName(name: string) {
        let result = name
        for (let i = 1; occupied.has(result); i++) {
          result = `${name} ${i}`
        }
        return result
      }

      const providers = ['github', 'microsoft']
      for (const providerId of providers) {
        const accounts = await authentication.getAccounts(providerId)
        if (accounts.length > 0) {
          if (!avatarUrl.value && providerId === 'github') {
            avatarUrl.value = `https://github.com/${accounts[0].id}.png?size=128`
          }
          return toFreeName(accounts[0].label)
        }
      }

      if (isHost) {
        return 'Host'
      }

      const newName = await window.showInputBox({
        prompt: 'Enter your name',
        placeHolder: 'Your name',
        value: toFreeName('Guest'),
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (occupied.has(value)) {
            return 'This name is already taken. Please choose another one.'
          }
          if (value.length === 0) {
            return 'Name cannot be empty.'
          }
          if (value.length > 16) {
            return 'Name is too long.'
          }
          return null
        },
      })
      if (newName === undefined) {
        return null
      }
      configs.$update('userName', newName, ConfigurationTarget.Global)
      return newName
    }
  }

  function getUserInfo(peerId: string) {
    void mapVersion.value
    const user = map.value?.get(peerId)
    return {
      name: user?.name || 'Unknown',
      avatarUrl: user?.avatarUrl || null,
      color: user?.color || {
        id: 'p2pliveshare.participant.loading',
        fg: TransparentColor[0],
        bg: TransparentColor[1],
      },
    }
  }

  function join() {
    if (!map.value || !selfId.value || !userName.value) {
      return
    }
    map.value.set(selfId.value, {
      name: userName.value,
      avatarUrl: avatarUrl.value,
      color: null,
    })
  }

  function leave() {
    if (!map.value || !selfId.value || !userName.value) {
      return
    }
    map.value.delete(selfId.value)
  }

  // Cleanup clients when disconnected
  watch(peers, (peers) => {
    if (!map.value || state.value?.role !== 'host' || !peers) {
      return
    }
    for (const peerId of map.value.keys()) {
      if (peerId !== selfId.value && !peers.includes(peerId)) {
        map.value.delete(peerId)
      }
    }
  })

  async function pickPeerId() {
    if (!peers.value?.length) {
      return undefined
    }
    const result = await window.showQuickPick(
      peers.value
        .filter(peerId => peerId !== selfId.value)
        .map((peerId) => {
          const user = getUserInfo(peerId)
          return {
            peerId,
            label: user.name,
            picked: false,
            alwaysShow: true,
          }
        }),
    )
    return result?.peerId
  }

  return {
    peers,
    userName,
    inquireUserName,
    getUserInfo,
    join,
    leave,
    pickPeerId,
  }
})

export function useCurrentUser() {
  const { join, leave } = useUsers()
  setTimeout(join, 10)
  onScopeDispose(leave)
}
