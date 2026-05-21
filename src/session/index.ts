import { computed, defineService, onScopeDispose, shallowRef, useCommand, useVscodeContext, watch } from 'reactive-vscode'
import { commands, env, Uri, window, workspace } from 'vscode'
import { version } from '../../package.json'
import { CustomUriScheme } from '../fs/provider'
import { copyShareLink, inquireHostConfig, makeTrackUri, parseTrackUri, validateShareLink } from '../sync/share'
import { useUsers } from '../ui/users'
import { useWebview } from '../webview'
import { createGuestSession } from './guest'
import { createHostSession } from './host'
import { useFsProvider } from '../fs/provider'

export const useActiveSession = defineService(() => {
  const session = shallowRef<null
    | Awaited<ReturnType<typeof createHostSession>>
    | Awaited<ReturnType<typeof createGuestSession>>
  >(null)
  const isJoining = shallowRef(true)


  setTimeout(async () => {
    // // DEVOCTO FIX: Escudo 1 (Auto-join). 
    // // Se o servidor backend já possui uma sessão ativa iniciada por outra aba, 
    // // aborta a criação de uma nova conexão de rede para evitar colapso de concorrência.
    // if (session.value) {
    //   isJoining.value = false
    //   return
    // }

    const folder = workspace.workspaceFolders?.find(folder => folder.uri.scheme === CustomUriScheme)
    try {
      if (folder) {
        // Tenta conectar. Se for a Aba B herdando da Aba A, isso retorna true rapidao.
        // Se for um container reiniciado, isso vai esperar 15s, falhar e retornar false.
        const sucesso = await joinImpl(folder.uri)
        
        if (!sucesso) {
          // LIMPEZA PÓS-MORTEM DEVOCTO: A sessao realmente morreu. Limpamos a arvore.
          const indexParaRemover = workspace.workspaceFolders?.findIndex(f => f.uri.scheme === CustomUriScheme)
          if (indexParaRemover !== undefined && indexParaRemover !== -1) {
            workspace.updateWorkspaceFolders(indexParaRemover, 1)
          }
        }
      }
    }
    finally {
      isJoining.value = false
    }
  })
  function toTrackUri(uri: Uri) {
    if (!session.value) {
      throw new Error('Not in a session')
    }
    if (session.value.role === 'guest') {
      return uri
    }
    return session.value.connection.toTrackUri(uri)
  }

  function toLocalUri(uri: Uri) {
    if (!session.value) {
      throw new Error('Not in a session')
    }
    if (session.value.role === 'guest') {
      return uri
    }
    return session.value.connection.toHostUri(uri)
  }

  async function host() {
    if (session.value) {
      window.showErrorMessage('You are already in a session.')
      return
    }
    if (isJoining.value) {
      return
    }
    isJoining.value = true
    try {
      const [config, _] = await Promise.all([
        inquireHostConfig(),
        useWebview().ensureReady(),
      ])
      if (!config) {
        return
      }

      try {
        session.value = await createHostSession(config)

        // DEVOCTO: Libera a trava de segurança apenas para o dono da sala
        const fs = useFsProvider()
        fs.isReadonly.value = false
      }
      catch (error: any) {
        console.error(error)
        window.showErrorMessage(
          'CRC Live Share (Puc Minas): Failed to start hosting.',
          {
            modal: true,
            detail: error?.message || String(error),
          },
        )
        return
      }

      copyShareLink(config, true)
    }
    finally {
      isJoining.value = false
    }
  }

  async function join(newWindow: boolean | 'auto') {
    if (session.value) {
      window.showErrorMessage('You are already in a session.')
      return
    }
    if (isJoining.value) {
      return
    }
    isJoining.value = true
    try {
      const clipboard = await env.clipboard.readText()
      const uriStr = await window.showInputBox({
        prompt: 'Enter URI',
        // placeHolder: 'room-id',
        value: validateShareLink(clipboard) === null ? clipboard : undefined,
        validateInput: validateShareLink,
      })
      if (!uriStr) {
        return
      }
      let uri = Uri.parse(uriStr.trim())
      if (uri.path === '') {
        uri = uri.with({ path: '/' })
      }
      // TRAVA DE SEGURANÇA PARA O DEVOCTO:
      // Se o aluno já tem pastas abertas (Multi-Root), proíbe abrir em nova janela
      // Isso garante que os diretórios "Compartilhada" e "Workspace" nunca sumam.
      if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
        newWindow = false;
      }
      if (newWindow) {
        commands.executeCommand('vscode.openFolder', uri, newWindow === 'auto'
          ? undefined
          : {
              forceNewWindow: newWindow,
              forceReuseWindow: !newWindow,
            })
      }
      else {
        const parsed = parseTrackUri(uri)
        
        const pastasAtuais = workspace.workspaceFolders?.length ?? 0

        const sucesso = workspace.updateWorkspaceFolders(pastasAtuais, 0, {
          uri,
          name: `Sessão Ao Vivo ${"("+parsed?.roomId +")" || ''}`,
        })
        if (!sucesso) {
          window.showErrorMessage("Falha ao anexar a sessão. Verifique as permissões do arquivo projeto.code-workspace.");
        }
        await joinImpl(uri)
      }
    }
    finally {
      isJoining.value = false
    }
  }

  async function joinImpl(uri: Uri) {
    // // DEVOCTO FIX: Escudo 2 (Chamada Direta).
    // // Garante que a instância do code-server não abra uma segunda conexão de WebSocket/WebRTC
    // // com o professor caso a sessão já esteja populada.
    // if (session.value) {
    //   return
    // }
    const parsed = parseTrackUri(uri)
    if (!parsed) {
      window.showErrorMessage(
        'CRC Live Share (Puc Minas): Invalid Invite Link.',
        {
          modal: true,
          detail: 'The link you provided is not valid. Please check and try again. A valid link looks like: p2p-live-share://ws.room.domain:port/',
        },
      )
      return false
    }

    const { inquireUserName } = useUsers()

    const [name, _] = await Promise.all([
      inquireUserName(false),
      useWebview().ensureReady(),
    ])
    if (!name) {
      return false 
    }

    try {
      // Modificacao: Guardamos o resultado antes de atribuir à session
      const novaSessao = await createGuestSession(parsed, name)
      
      // Se novaSessao for null, significa que o timeout de 15s estourou no guest.ts!
      if (!novaSessao) {
        return false // Falhou (Container reiniciado / Zumbi)
      }

      session.value = novaSessao
      return true // Sucesso absoluto! A aba foi herdada ou a conexao é nova.
    }
    catch (error: any) {
      console.error(error)
      window.showErrorMessage(
        'CRC Live Share (Puc Minas): Failed to join the session.',
        {
          modal: true,
          detail: error?.message || String(error),
        },
      )
      return false
    }
  }

  async function leave() {
    if (!session.value) {
      window.showErrorMessage('You are not in a session.')
      return
    }

    const wasGuest = session.value.role === 'guest'

    const res = await window.showInformationMessage(
      wasGuest ? 'Confirm to leave the session?' : 'Confirm to stop sharing the session?',
      {
        modal: true,
        detail: wasGuest ? 'Unsaved changes may be lost.' : 'You will stop sharing the workspace and all guests will be disconnected.',
      },
      'Leave',
    )

    if (res === 'Leave') {
      session.value = null
      
      // DEVOCTO: Restaura a trava de segurança ao sair da sessão
      const fs = useFsProvider()
      fs.isReadonly.value = true

      if (wasGuest) {
        // workspace.updateWorkspaceFolders(0, workspace.workspaceFolders?.length)
        
        // Encontra o índice exato da pasta da sessão P2P e remove apenas ela (1)
        const indexParaRemover = workspace.workspaceFolders?.findIndex(f => f.uri.scheme === CustomUriScheme)
        if (indexParaRemover !== undefined && indexParaRemover !== -1) {
          workspace.updateWorkspaceFolders(indexParaRemover, 1)
        }
      }
      window.showInformationMessage('You have left the session.')
    }
  }
  /*
   * DEVOCTO FIX: A Morte Silenciosa do Clone
   * Aniquila a sessão apenas na memória desta aba (cortando o WebSocket),
   * mas NÃO toca nas pastas do VS Code nem no isReadonly, para não derrubar a Aba Nova.
   */
  async function kickLeave() {
    if (!session.value) return
    
    // Matar a sessão aqui dispara o scope.stop() automaticamente,
    // o que corta a conexão de rede desta aba com o professor.
    session.value = null
  }

  /*
   * Executa a destruicao imediata da sessao atual sem solicitar confirmacao do usuario.
   * Usado para desconectar forcadamente abas fantasmas (clones).
   */
  async function forceLeave() {
    if (!session.value) return

    const wasGuest = session.value.role === 'guest'

    // Aniquila o estado da sessao localmente
    session.value = null
    isConnectingGlobal = false 
    
    // Devolve a trava de seguranca do disco
    const fs = useFsProvider()
    fs.isReadonly.value = true

    // Remove a pasta virtual da barra lateral para limpar a interface
    if (wasGuest) {
      const indexParaRemover = workspace.workspaceFolders?.findIndex(f => f.uri.scheme === CustomUriScheme)
      if (indexParaRemover !== undefined && indexParaRemover !== -1) {
        workspace.updateWorkspaceFolders(indexParaRemover, 1)
      }
    }
  }

  watch(session, (_, oldState) => oldState?.scope.stop())
  onScopeDispose(() => session.value?.scope.stop())

  useVscodeContext('p2p-live-share:inSession', computed(() => !!session.value))
  useVscodeContext('p2p-live-share:isHost', computed(() => session.value?.role === 'host'))
  useVscodeContext('p2p-live-share:isGuest', computed(() => session.value?.role === 'guest'))

  useCommand('p2p-live-share.host', host)
  useCommand('p2p-live-share.join', () => join(false))
  useCommand('p2p-live-share.joinNewWindow', () => join(true))
  useCommand('p2p-live-share.leave', leave)
  // Adicione esta linha:
  useCommand('p2p-live-share.kickLeave', kickLeave)
  useCommand('p2p-live-share.stop', leave)
  // Registra o comando de aniquilacao silenciosa
  useCommand('p2p-live-share.forceLeave', forceLeave)
  useCommand('p2p-live-share.copyInviteLink', () => {
    if (session.value?.connection) {
      copyShareLink(session.value?.connection.config)
    }
    else {
      window.showErrorMessage('Not in a session.')
    }
  })

  return {
    state: session,
    role: computed(() => session.value?.role),
    doc: computed(() => session.value?.doc),
    selfId: computed(() => session.value?.connection.selfId),
    hostId: computed(() => session.value?.hostId),
    hostMeta: computed(() => session.value?.hostMeta),
    peers: computed(() => session.value?.connection.peers.value),
    connection: computed(() => session.value?.connection),
    shadowTerminals: computed(() => session.value?.shadowTerminals),
    isJoining,
    makeTrackUri,
    toTrackUri,
    toLocalUri,
    host,
    join,
    leave,
  }
})

export function onSessionClosed(options: {
  title: string
  detail: string
}) {
  const { state } = useActiveSession()
  if (!state.value) {
    return
  }
  const config = state.value.connection.config
  const creator = state.value.role === 'host' ? createHostSession : createGuestSession

  state.value = null
  const delay = new Promise(resolve => setTimeout(resolve, 500))
  window.showErrorMessage(
    options.title,
    {
      modal: true,
      detail: options.detail,
    },
    'Reconnect',
  ).then(async (choice) => {
    if (choice === 'Reconnect') {
      await delay
      state.value = await creator(config)
    }
  })
}

export const ProtocolVersion = version
