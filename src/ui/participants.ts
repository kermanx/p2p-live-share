import type { TreeViewNode } from 'reactive-vscode'
import { computed, defineService, ref, useTreeView,useCommand, useVscodeContext, watch } from 'reactive-vscode'
import { ThemeColor, ThemeIcon, Uri, window } from 'vscode'
import { useActiveSession } from '../session'
import { useSelections } from './selections'
import { useUsers } from './users'
import { UpdatePermissionsAction, UpdateGlobalLockAction, ForceSyncAction } from '../sync/ws/protocol'

export const useParticipantsTree = defineService(() => {
  //----- DEVOCTO: Implementação da Trava de Segurança para o Professor ---
 // 1. PRIMEIRO: Puxamos as variáveis vitais da sessão
  const { peers, getUserInfo } = useUsers()
  const { getSelection, following } = useSelections()
  const { toLocalUri, hostId, connection } = useActiveSession()

  // 2. SEGUNDO: Criamos nossas variáveis de segurança do Devocto
  const allowedPeers = ref<string[]>([])
  
  const globalLock = ref(true)
  useVscodeContext('p2p-live-share:globalLock', globalLock)

  // 3. TERCEIRO: Uma única função de rede que envia TUDO (VIP + Cadeado Global)
  function broadcastPermissions() {
    if (!connection.value) return
    
    // Manda a lista VIP
    const [sendVip] = connection.value.makeAction<string[]>(UpdatePermissionsAction)
    sendVip(allowedPeers.value)
    
    // Manda o status do Cadeado Global
    const [sendGlobal] = connection.value.makeAction<boolean>(UpdateGlobalLockAction)
    sendGlobal(globalLock.value)
  }

  // 4. QUARTO: Os Monitores e Comandos dos Botões
  // Se um aluno entrar novo na sala, avisa a rede como estão as travas
  watch(peers, () => {
    broadcastPermissions()
  })

  // Comandos da Trava Global (Botões do Topo)
  useCommand('p2p-live-share.unlockAll', () => {
    globalLock.value = false
    broadcastPermissions()
  })

  useCommand('p2p-live-share.lockAll', () => {
    globalLock.value = true
    broadcastPermissions()
  })

// Registra o comando de Liberar Edição
  useCommand('p2p-live-share.allowEdit', (node: any) => {
    const peerId = node?.treeItem?.peerId || node?.peerId
    if (!peerId) return

    // Força a reatividade do Vue recriando o array
    if (!allowedPeers.value.includes(peerId)) {
      allowedPeers.value = [...allowedPeers.value, peerId];
      broadcastPermissions();
    }
  })

// Registra o comando de Bloquear Edição
  useCommand('p2p-live-share.revokeEdit', (node: any) => {
    const peerId = node?.treeItem?.peerId || node?.peerId
    if (!peerId) return

    // Remove o aluno criando um array novo (Reatividade garantida)
    allowedPeers.value = allowedPeers.value.filter(id => id !== peerId);
    broadcastPermissions();
  })


  // 5. O Comando de Sincronização Forçada (Botão do Topo)
  useCommand('p2p-live-share.forceSync', () => {
    if (!connection.value) return
    const [sendSync] = connection.value.makeAction<void>(ForceSyncAction)
    sendSync()
    window.showInformationMessage("Sinal de sincronização forçada enviado para os alunos.");
  })
  // -------------------------------------------------------------------
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
    computed(() => orderedPeers.value.map<TreeViewNode>((peerId) => {
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

      // if (peerId === hostId.value) {
      //   description += ' (Host)'
      // }
      // if (isFollowing) {
      //   description += ' (Following)'
      // }

      // -------------devocto-------------------------------

      const isHost = peerId === hostId.value;

      if (isHost) {
        description += ' (Host)'
      }
      if (isFollowing) {
        description += ' (Following)'
      }
      // DEVOCTO: Altera a descrição para mostrar quem está bloqueado na tela do Professor
      // O aluno pode editar se: É host OU a trava global está desligada OU ele é VIP.
      const canEdit = isHost || !globalLock.value || allowedPeers.value.includes(peerId);
      
      if (!canEdit) {
        description += ' 🔒 (Somente Leitura)'
      } else if (!isHost) {
        description += ' ✏️ (Pode Editar)'
      }

      // Adicionamos o status na variável de contexto para podermos filtrar os botões
      let contextValue = isFollowing ? 'following' : 'not-following'

      if (isHost) {
        contextValue += '-ishost' // O professor não precisa de cadeado nele mesmo
      } else {
        contextValue += canEdit ? '-can-edit' : '-readonly'
      }
      // --------------------------------------------------
      return {
        treeItem: {
          iconPath: new ThemeIcon(isFollowing ? 'circle-filled' : 'circle', new ThemeColor(user.color.id)),
          label: user?.name ?? 'Unknown',
          description,
          tooltip,
          contextValue,
          command: {
            title: 'Focus Participant',
            command: 'p2p-live-share.focusParticipant',
            arguments: [peerId],
          },
          peerId,
        },
      }
    })),
  )
})
