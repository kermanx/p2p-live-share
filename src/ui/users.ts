import type * as Y from 'yjs'
import type { Connection } from '../sync/connection'
import { computed, defineService, onScopeDispose, ref, watch } from 'reactive-vscode'
import { authentication, ConfigurationTarget, window } from 'vscode'
import { configs } from '../configs'
import { useActiveSession } from '../session'
import { useObserverDeep } from '../sync/doc'
import { createColorAllocator, LoadingColor } from './colors'

export interface UserColor {
  id: string
  fg: string
  bg: string
}

export interface UserInfo {
  name: string
  color: UserColor | null
}

export const useUsers = defineService(() => {
  const { role, doc, selfId, peers, state } = useActiveSession()

  const map = computed(() => doc.value?.getMap<UserInfo>('users'))

  const colorAllocator = createColorAllocator()
  const userName = ref<string | null>(null)

  const mapVersion = useObserverDeep(map, (event, map) => {
    for (const [peerId, { action }] of event.keys) {
      if (action === 'add') {
        const user = map.get(peerId) as UserInfo

        if (role.value === 'host') {
          map.set(peerId, {
            ...user,
            color: colorAllocator.alloc(user.name),
          })
        }
      }
    }
  }, (map) => {
    if (role.value === 'host') {
      for (const [peerId, user] of map.entries()) {
        map.set(peerId, {
          ...user,
          color: colorAllocator.alloc(user.name),
        })
      }
    }
  })

  async function inquireUserName(isHost: boolean) {
    if (userName.value) return userName.value

    const usernameUsuarioDevocto = process.env.DEVOCTO_USERNAME
    const nomeCompletoUsuario = process.env.DEVOCTO_NAME
    
    if (usernameUsuarioDevocto) {
      const primeiroNome = nomeCompletoUsuario?.split(' ')[0] || usernameUsuarioDevocto
      return userName.value = `${primeiroNome} (${usernameUsuarioDevocto})`
    }

    // Se o professor/aluno abrir fora do ecossistema principal em modo de teste local
    return userName.value = isHost ? 'Professor' : 'Estudante'
  }

  function getUserInfo(peerId: string) {
    void mapVersion.value
    const user = map.value?.get(peerId)
    return {
      name: user?.name || 'Unknown',
      color: user?.color || LoadingColor,
    }
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

  function useCurrentUser({ selfId }: Connection, doc: Y.Doc) {
    if (!userName.value) {
      throw new Error('User name is not set.')
    }
    const map = doc.getMap<UserInfo>('users')
    map.set(selfId, {
      name: userName.value,
      color: null,
    })
    onScopeDispose(() => {
      map.delete(selfId)
    })
  }

  return {
    peers,
    userName,
    inquireUserName,
    getUserInfo,
    pickPeerId,
    useCurrentUser,
  }
})
