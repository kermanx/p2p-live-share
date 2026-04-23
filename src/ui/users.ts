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
  avatarUrl: string | null
  color: UserColor | null
}

export const useUsers = defineService(() => {
  const { role, doc, selfId, peers, state } = useActiveSession()

  const map = computed(() => doc.value?.getMap<UserInfo>('users'))

  const colorAllocator = createColorAllocator()
  const userName = ref<string | null>(null)
  const avatarUrl = ref<string | null>(null)

  const mapVersion = useObserverDeep(map, (event, map) => {
    for (const [peerId, { action, oldValue }] of event.keys) {
      if (action === 'add') {
        const user = map.get(peerId) as UserInfo

        if (role.value === 'host') {
          map.set(peerId, {
            ...user,
            color: colorAllocator.alloc(user.name),
          })
        }

        if (peerId !== selfId.value) {
          window.showInformationMessage(`${user.name} joined the session.`)
        }
      }
      else if (action === 'delete') {


        if (peerId !== selfId.value && state.value) {
          window.showInformationMessage(`${oldValue.name} left the session.`)
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
    return userName.value = await worker()
    async function worker() {
      // Retorna o nome já processado se ele já existir na memória
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

      // Lógica de captura das variáveis de ambiente do Devocto
      const usernameUsuarioDevocto = process.env.DEVOCTO_USERNAME
      const nomeCompletoUsuario = process.env.DEVOCTO_NAME
      
      if (usernameUsuarioDevocto) {
        const primeiroNome = nomeCompletoUsuario?.split(' ')[0] || usernameUsuarioDevocto
        const nomeFormatado = `${primeiroNome} (${usernameUsuarioDevocto})`
        return toFreeName(nomeFormatado)
      }

      // Fallback para as configurações do VS Code caso a ENV não exista
      if (configs.userName) {
        return toFreeName(configs.userName)
      }

      if (isHost) {
        return 'Professor'
      }

      const newName = await window.showInputBox({
        prompt: 'Informe seu nome para a sessão',
        placeHolder: 'Seu nome',
        value: toFreeName('Estudante'),
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (occupied.has(value)) {
            return 'Este nome já está sendo usado na sala.'
          }
          if (value.length === 0) {
            return 'O nome não pode ficar vazio.'
          }
          if (value.length > 25) { // Aumentei um pouco o limite por causa do formato "Nome (User)"
            return 'O nome está muito longo.'
          }
          return null
        },
      })

      if (newName === undefined) {
        return toFreeName('Estudante')
      }

      configs.update('userName', newName, ConfigurationTarget.Global)
      return newName
    }
  }

  function getUserInfo(peerId: string) {
    void mapVersion.value
    const user = map.value?.get(peerId)
    return {
      name: user?.name || 'Unknown',
      avatarUrl: user?.avatarUrl || null,
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
      avatarUrl: avatarUrl.value,
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
