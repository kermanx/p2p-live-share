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
  
  const [send, recv] = connection.makeAction<Uint8Array, [string, TextDocumentChangeReason?]>('texts')

  // DEVOCTO FIX 1: O Ataque Furtivo (Substitui a "preguiça" do VS Code)
  recv(async (update, peerId, meta) => {
    const [uriStr, reason] = meta!
    const file = files.get(uriStr)
    if (file) {
      Y.applyUpdateV2(file.doc, update, { reason, peerId })

      // Se o aluno está bloqueado, o VS Code se recusa a atualizar a tela em background.
      // Solução: Abaixamos a trava por milissegundos, colamos o texto, salvamos e trancamos.
      if (isReadonly.value) {
        try {
          isReadonly.value = false; // Abaixa o escudo
          const uri = Uri.parse(uriStr);
          const doc = await workspace.openTextDocument(uri);
          const edit = new WorkspaceEdit();
          const fullRange = new Range(
              new Position(0, 0),
              doc.lineAt(doc.lineCount > 0 ? doc.lineCount - 1 : 0).range.end
          );
          edit.replace(uri, fullRange, file.doc.getText().toString());
          await workspace.applyEdit(edit);
          await doc.save(); // Salva para não disparar o erro vermelho de permissão
        } catch (e) {
          console.error("Erro na atualização visual forçada", e);
        } finally {
          isReadonly.value = true; // Ergue o escudo
        }
      }
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

      // Fail-Safe de Rede (Segurança Máxima)
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
  let isGlobalLocked = true;
  let isVip = false;

  async function atualizarCadeado() {
    const estavaTrancado = isReadonly.value;
    isReadonly.value = isGlobalLocked && !isVip;

    if (estavaTrancado !== isReadonly.value) {
      if (isReadonly.value) {
        window.showWarningMessage("O Professor ativou o Modo Controle. Você agora é Somente Leitura.");
      } else {
        window.showInformationMessage("Modo de Edição liberado para você!");
      }

      // Dispara a atualização visual do cadeado na aba
      const mudancas = Array.from(files.keys()).map(uriStr => ({
        uri: Uri.parse(uriStr),
        type: 2 // FileChangeType.Changed
      }));
      if (mudancas.length > 0) {
        fileChanged(mudancas);
      }

      // DEVOCTO FIX 2: A Reconexão Automática
      // O fileChanged acima destrói o vínculo entre a tela do VS Code e a memória do Y.js.
      // Se o aluno foi DESBLOQUEADO, nós reconstruímos esse vínculo em milissegundos
      // para ele poder digitar na mesma hora e tudo ir para o professor sem falhas.
      if (!isReadonly.value) {
        for (const uriStr of Array.from(files.keys())) {
          const file = files.get(uriStr);
          if (file) {
            file.doc.destroy();
            files.delete(uriStr);
            await rpc.untrackContent({ guestId: connection.selfId, uri: uriStr });
            await trackContent(uriStr);
          }
        }
      }
    }
  }

  const [___, recvPermissions] = connection.makeAction<string[]>(UpdatePermissionsAction)
  recvPermissions(async (allowedPeers) => {
    isVip = allowedPeers.includes(connection.selfId);
    await atualizarCadeado();
  })

  const [____, recvGlobalLock] = connection.makeAction<boolean>(UpdateGlobalLockAction)
  recvGlobalLock(async (locked) => {
    isGlobalLocked = locked;
    await atualizarCadeado();
  })

  // DEVOCTO: RESET ABSOLUTO (Sincronização Forçada)
  const [_____, recvForceSync] = connection.makeAction<void>(ForceSyncAction)
  recvForceSync(async () => {
    window.showWarningMessage("Sincronização forçada pelo Professor. Revertendo e nivelando arquivos...");
    
    const estavaBloqueado = isReadonly.value;
    isReadonly.value = false;

    try {
      for (const [uriStr, file] of files.entries()) {
        const uri = Uri.parse(uriStr);

        const hostState = await rpc.trackContent({ guestId: connection.selfId, uri: uriStr });
        const tempDoc = new Y.Doc();
        Y.applyUpdateV2(tempDoc, hostState);
        const textoDoProfessor = tempDoc.getText().toString();

        file.doc.destroy();
        
        const doc = await workspace.openTextDocument(uri);
        const edit = new WorkspaceEdit();
        const fullRange = new Range(
            new Position(0, 0),
            doc.lineAt(doc.lineCount > 0 ? doc.lineCount - 1 : 0).range.end
        );
        edit.replace(uri, fullRange, textoDoProfessor);

        const newDoc = new Y.Doc();
        Y.applyUpdateV2(newDoc, hostState);
        files.set(uriStr, { doc: newDoc, mtime: Date.now() });

        await workspace.applyEdit(edit);
        await doc.save();

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
      isReadonly.value = estavaBloqueado;
      
      const mudancas = Array.from(files.keys()).map(u => ({ uri: Uri.parse(u), type: 2 }));
      if (mudancas.length > 0) fileChanged(mudancas);
    }
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
    // A Trava Física Absoluta Indestrutível
    async stat(uri) {
      const file = files.get(uri.toString())
      const permissoes = isReadonly.value ? 1 : undefined;

      if (file) {
        return {
          type: FileType.File,
          ctime: file.ctime ??= handleFsError(await rpc.fsStat(uri.toString())).ctime,
          mtime: file.mtime,
          size: file.doc.getText().length,
          permissions: permissoes
        }
      }
      
      const hostStat = handleFsError(await rpc.fsStat(uri.toString()));
      hostStat.permissions = permissoes;
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