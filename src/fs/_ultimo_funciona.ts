import type { BirpcReturn } from 'birpc'
import type { TextDocumentChangeReason } from 'vscode'
import type { GuestFunctions, HostFunctions } from '../rpc/types'
import type { Connection } from '../sync/connection'
import type { FileChangeEvent } from './common'
import { computed, defineConfig, useDisposable } from 'reactive-vscode'
import { FileType, Uri, workspace, window, WorkspaceEdit, Range, Position } from 'vscode'
import * as Y from 'yjs'
import { forceUpdateContent, handleFsError, setupTextDocumentUpdater, useTextDocumentWatcher } from './common'
import { CustomUriScheme, useFsProvider } from './provider'
import { UpdatePermissionsAction, UpdateGlobalLockAction, ForceSyncAction } from '../sync/ws/protocol'

const filesConfig = defineConfig<any>('files')

export function useGuestFs(connection: Connection, rpc: BirpcReturn<HostFunctions, GuestFunctions>, hostId: string) {
  const { fileChanged, useSetActiveProvider, isReadonly } = useFsProvider()

  const files = new Map<string, {
    doc: Y.Doc
    mtime: number
    ctime?: number
  }>()
  async function syncAux(){
// 1. Abaixa o escudo do disco temporariamente para podermos reescrever a tela
    const estavaBloqueado = isReadonly.value;
    isReadonly.value = false;

    try {
      for (const [uriStr, file] of files.entries()) {
        const uri = Uri.parse(uriStr);

        // 2. Busca a memória RAM real e ao vivo do Professor
        const hostState = await rpc.trackContent({ guestId: connection.selfId, uri: uriStr });
        const tempDoc = new Y.Doc();
        Y.applyUpdateV2(tempDoc, hostState);
        const textoDoProfessor = tempDoc.getText().toString(); // O texto exato da tela do prof!

        // 3. Destrói a memória divergente do aluno
        file.doc.destroy();
        
        // 4. Pega o editor do aluno e apaga todo o conteúdo, colando o do professor
        const doc = await workspace.openTextDocument(uri);
        const edit = new WorkspaceEdit();
        const fullRange = new Range(
            new Position(0, 0),
            doc.lineAt(doc.lineCount > 0 ? doc.lineCount - 1 : 0).range.end
        );
        edit.replace(uri, fullRange, textoDoProfessor);

        // 5. Recria a memória do aluno ANTES de injetar o texto, para manter a conexão viva
        const newDoc = new Y.Doc();
        Y.applyUpdateV2(newDoc, hostState);
        files.set(uriStr, { doc: newDoc, mtime: Date.now() });

        // Injeta a mudança no VS Code e Salva (Matando qualquer status "Dirty")
        await workspace.applyEdit(edit);
        await doc.save();

        // 6. Religa as antenas de rede
        newDoc.on('updateV2', async (update: Uint8Array, origin: any) => {
          if (origin?.peerId) return;
          if (isReadonly.value) return;
          await send(update, hostId, [uriStr, origin?.reason])
        });
        setupTextDocumentUpdater(uri, newDoc);
      }
    } catch (e) {
      console.error("Falha ao forçar sincronia no arquivo", e);
    } finally {
      // 7. Devolve a trava de disco pro estado que o professor mandou
      isReadonly.value = estavaBloqueado;

      // DEVOCTO FIX: O "Respiro" do VS Code
      // Esperamos 100ms para o VS Code terminar de processar o doc.save() 
      // antes de forçarmos ele a ler o stat() novamente com a trava levantada.
      setTimeout(() => {
        const mudancas = Array.from(files.keys()).map(u => ({ uri: Uri.parse(u), type: 2 }));
        if (mudancas.length > 0) fileChanged(mudancas);
      }, 400);
    }
}
  const [send, recv] = connection.makeAction<Uint8Array, [string, TextDocumentChangeReason?]>('texts')
  // Recebe as atualizações do Professor
  // recv(async (update, peerId, meta) => {
  //   const [uriStr, reason] = meta!
  //   const file = files.get(uriStr)
  //   if (file) {
  //     Y.applyUpdateV2(file.doc, update, { reason, peerId })

  //     // FIX DA PREGUIÇA: Se o aluno estiver bloqueado, forçamos o VS Code a escrever na tela.
  //     if (isReadonly.value) {
  //       try {
  //         isReadonly.value = false; // Abaixa o escudo num piscar de olhos
  //         const uri = Uri.parse(uriStr);
  //         const doc = await workspace.openTextDocument(uri);
  //         const edit = new WorkspaceEdit();
  //         const fullRange = new Range(
  //             new Position(0, 0),
  //             doc.lineAt(doc.lineCount > 0 ? doc.lineCount - 1 : 0).range.end
  //         );
  //         edit.replace(uri, fullRange, file.doc.getText().toString());
  //         await workspace.applyEdit(edit);
  //         await doc.save();
  //       } catch (e) {
  //         console.error("Erro na atualização furtiva", e);
  //       } finally {
  //         isReadonly.value = true; // Sobe o escudo novamente
  //       }
  //     }
  //   }
  // })
  // Recebe as atualizações do Professor
  recv((update, peerId, meta) => {
    const [uri, reason] = meta!
    const file = files.get(uri)
    if (file) {
      Y.applyUpdateV2(file.doc, update, { reason, peerId })
    }
  })

  async function trackContent(uri: string) {
    const doc = new Y.Doc()
    const init = await rpc.trackContent({ guestId: connection.selfId, uri })
    Y.applyUpdateV2(doc, init)
    files.set(uri, {
      doc,
      mtime: Date.now(),
    })

    doc.on('updateV2', async (update: Uint8Array, origin: any) => {
      if (origin?.peerId)
        return

      // DEVOCTO: Fail-Safe de Rede (Segurança Máxima)
      // Se o aluno está bloqueado, ignoramos qualquer tecla que ele apertar. 
      // Isso garante que NADA chegue no professor caso ele tente burlar a interface.
      if (isReadonly.value) return;

      await send(update, hostId, [uri, origin?.reason])
    })
    setupTextDocumentUpdater(Uri.parse(uri), doc)
  }

  useTextDocumentWatcher((document) => {
    if (document.uri.scheme === CustomUriScheme) {
      const uri = document.uri.toString()
      const file = files.get(uri)
      if (file)
        return file.doc

      console.warn('Document updated before tracking:', uri)
      trackContent(uri)
    }
  })

  useDisposable(workspace.onDidOpenTextDocument(({ uri }) => {
    if (uri.scheme === CustomUriScheme)
      trackContent(uri.toString())
  }))
  
  useDisposable(workspace.onDidCloseTextDocument(({ uri }) => {
    if (uri.scheme === CustomUriScheme) {
      files.delete(uri.toString())
      rpc.untrackContent({ guestId: connection.selfId, uri: uri.toString() })
    }
  }))

  const [__, recvSave] = connection.makeAction<string>('textSave')
  const autoSave = computed(() => filesConfig.autoSave === 'afterDelay')
  
  recvSave(async (uri) => {
    if (autoSave.value)
      return
    const file = files.get(uri)
    if (file) {
      const document = await workspace.openTextDocument(Uri.parse(uri))
      await document.save()
    }
  })

  const willSaveDocuments = new Set<string>()
  useDisposable(workspace.onWillSaveTextDocument(({ document }) => {
    if (document.uri.scheme === CustomUriScheme) {
      willSaveDocuments.add(document.uri.toString())
    }
  }))

  const [_, recvFsChange] = connection.makeAction<FileChangeEvent>('fsChange')
  recvFsChange(({ uri, type }) => fileChanged([{ uri: Uri.parse(uri), type }]))

  // Controle de estado de bloqueio
  let isGlobalLocked = true; //nasce trancado (Modo Controle ativado)
  let isVip = false; // nasce sem vip, o professor que decide isso.

  async function atualizarCadeado() {
    const estavaTrancado = isReadonly.value;
    isReadonly.value = isGlobalLocked && !isVip;

    if (estavaTrancado !== isReadonly.value) {
      if (isReadonly.value) {
        window.showWarningMessage("O Professor ativou o Modo Controle. Você agora é Somente Leitura.");
      
      // Se foi trancado, apenas atualiza a interface para mostrar o cadeado
        const mudancas = Array.from(files.keys()).map(uriStr => ({
          uri: Uri.parse(uriStr),
          type: 2
        }));
        if (mudancas.length > 0) {
          fileChanged(mudancas);
        } 
        // DEVOCTO FIX: O "Respiro" do VS Code
        setTimeout(() => {
          const mudancas = Array.from(files.keys()).map(u => ({ uri: Uri.parse(u), type: 2 }));
          if (mudancas.length > 0) fileChanged(mudancas);
        }, 400);
      } else {
        
        // Remove o cadeado visual
        const mudancas = Array.from(files.keys()).map(uriStr => ({ uri: Uri.parse(uriStr), type: 2 }));
        if (mudancas.length > 0) fileChanged(mudancas);
        // FIX DO DESBLOQUEIO MUDO: Se destrancou, reconecta os cabos do Y.js usando syncAux!
        setTimeout(async () => {
          window.showInformationMessage("Modo de Edição liberado para você!");
          await syncAux();
        }, 400);
      }

    }
  }
  // DEVOCTO: Ouvinte de Permissões e Trava Global
  const [___, recvPermissions] = connection.makeAction<string[]>(UpdatePermissionsAction)
  recvPermissions((allowedPeers) => {
    isVip = allowedPeers.includes(connection.selfId);
    atualizarCadeado();
  })
  // DEVOCTO: Ouvinte de Trava Global
  const [____, recvGlobalLock] = connection.makeAction<boolean>(UpdateGlobalLockAction)
  recvGlobalLock((locked) => {
    isGlobalLocked = locked;
    atualizarCadeado();
  })
  
  // DEVOCTO: RESET ABSOLUTO (A Sincronização Forçada)
  // usado se algum bug tenha ocorrido, para voltar a sincronizar com o host
  const [_____, recvForceSync] = connection.makeAction<void>(ForceSyncAction)
  recvForceSync(async () => {
    window.showWarningMessage("Sincronização forçada pelo Professor. Revertendo e nivelando arquivos...");
    
    await syncAux();
    
  })

  useSetActiveProvider({
    watch(uri_, options) {
      const handle = rpc.fsWatch(connection.selfId, uri_.toString(), options)
      return {
        async dispose() {
          await rpc.fsUnwatch(await handle)
        },
      }
    },
    // Aqui garantimos que o sistema de arquivos fique sempre livre para a 
    // extensão conseguir injetar as letras do professor a qualquer momento.
    async stat(uri) {
      const file = files.get(uri.toString())
      const permissoes = isReadonly.value ? 1 : undefined; // 1 = Somente Leitura

      if (file) {
        return {
          type: FileType.File,
          ctime: file.ctime ??= handleFsError(await rpc.fsStat(uri.toString())).ctime,
          mtime: file.mtime,
          size: file.doc.getText().length,
          permissions: permissoes // Aplica a trava aqui
        }
      }
      
      const hostStat = handleFsError(await rpc.fsStat(uri.toString()));
      hostStat.permissions = permissoes; // E aplica aqui também
      return hostStat;
    },
    async readDirectory(uri) {
      return handleFsError(await rpc.fsReadDirectory(uri.toString()))
    },
    async createDirectory(uri) {
      return handleFsError(await rpc.fsCreateDirectory(uri.toString()))
    },
    async readFile(uri) {
      return handleFsError(await rpc.fsReadFile(uri.toString()))
    },
    async writeFile(uri, content, options) {
      const file = files.get(uri.toString())
      if (file) {
        if (!willSaveDocuments.delete(uri.toString())) {
          forceUpdateContent(uri, file.doc, content)
        }
        await rpc.saveContent(uri.toString())
        return
      }
      return handleFsError(await rpc.fsWriteFile(uri.toString(), content, options))
    },
    async delete(uri, options) {
      return handleFsError(await rpc.fsDelete(uri.toString(), options))
    },
    async rename(oldUri, newUri, options) {
      return handleFsError(await rpc.fsRename(oldUri.toString(), newUri.toString(), options))
    },
  })
}