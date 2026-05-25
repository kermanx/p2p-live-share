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
  const allowedNames = ref<string[]>([])

  // // 2. SEGUNDO: Criamos nossas variáveis de segurança do Devocto
  // const allowedPeers = ref<string[]>([])
  
  const globalLock = ref(true)
  useVscodeContext('p2p-live-share:globalLock', globalLock)

  // 3. TERCEIRO: Uma única função de rede que envia TUDO (VIP + Cadeado Global)
  function broadcastPermissions() {
    if (!connection.value) return
    // Tradutor de Identidade: Busca quem esta online agora e converte os Nomes VIPs 
    // de volta para os peerIds temporarios que o sistema de rede exige.
    const currentAllowedPeerIds = (peers.value || []).filter(peerId => {
      const user = getUserInfo(peerId)
      return user && allowedNames.value.includes(user.name)
    })
    // Manda a lista VIP
    const [sendVip] = connection.value.makeAction<string[]>(UpdatePermissionsAction)
    sendVip(currentAllowedPeerIds)
    
    // Manda o status do Cadeado Global
    const [sendGlobal] = connection.value.makeAction<boolean>(UpdateGlobalLockAction)
    sendGlobal(globalLock.value)
  }

  //  Criamos um "Radar de Identidades"
  // Esta variavel computada vai mudar sempre que o Y.js terminar de 
  // carregar o nome verdadeiro de um aluno que acabou de entrar.
  const identidadesDaSala = computed(() => {
    return (peers.value || []).map(id => getUserInfo(id).name).join(',')
  })

  // O Vigia Duplo
  // Agora reavaliamos os VIPs em dois cenarios:
  // - Quando um cabo (peerId) conecta ou desconecta.
  // - Quando uma mascara cai e o nome verdadeiro sincroniza (identidadesDaSala muda).
  watch([peers, identidadesDaSala], () => {
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

  const userName = getUserInfo(peerId).name
    if (!allowedNames.value.includes(userName)) {
      allowedNames.value = [...allowedNames.value, userName];
      broadcastPermissions();
    }
  })

// Registra o comando de Bloquear Edição
  useCommand('p2p-live-share.revokeEdit', (node: any) => {
    const peerId = node?.treeItem?.peerId || node?.peerId
    if (!peerId) return

    // Remove o aluno criando um array novo (Reatividade garantida)
    const userName = getUserInfo(peerId).name
    allowedNames.value = allowedNames.value.filter(name => name !== userName);
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

      let description = ''

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
      // Validacao visual atualizada para usar o nome em vez do peerId
      const canEdit = isHost || !globalLock.value || allowedNames.value.includes(user.name);
      
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
