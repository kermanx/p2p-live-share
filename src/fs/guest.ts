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
  const { fileChanged, useSetActiveProvider, isReadonly, isPermissionLocked, isSystemOverride } = useFsProvider()

  const files = new Map<string, {
    doc: Y.Doc
    mtime: number
    ctime?: number
    lastSafeText?: string
  }>()

  let sincronizando = false;
  let sincronizacaoPendente = false;

  async function syncAux() {
    if (sincronizando) {
      sincronizacaoPendente = true;
      return;
    }
    sincronizando = true;
    sincronizacaoPendente = false;

    try {
      for (const [uriStr, file] of files.entries()) {
        const hostState = await rpc.trackContent({ guestId: connection.selfId, uri: uriStr });
        // Aplica na memoria. O arquivo common.ts detecta e atualiza a interface confiavelmente.
        Y.applyUpdate(file.doc, hostState);
        file.lastSafeText = file.doc.getText().toString();
      }
    } catch (e) {
      console.error("Falha ao forçar sincronia", e);
    } finally {
      sincronizando = false;
      if (sincronizacaoPendente) syncAux();
    }
  }

  const [send, recv] = connection.makeAction<Uint8Array, [string, TextDocumentChangeReason?]>('texts')

  recv((update, peerId, meta) => {
    const [uriStr, reason] = meta!
    const file = files.get(uriStr)
    if (file) {
      Y.applyUpdate(file.doc, update, { reason, peerId })
    }
  })

  async function trackContent(uri: string) {
    const doc = new Y.Doc()
    const init = await rpc.trackContent({ guestId: connection.selfId, uri })
    Y.applyUpdate(doc, init)
    files.set(uri, {
      doc,
      mtime: Date.now(),
      lastSafeText: doc.getText().toString()
    })

    doc.on('update', async (update: Uint8Array, origin: any) => {
      if (origin?.peerId) return
      if (isPermissionLocked.value) return
      await send(update, hostId, [uri, origin?.reason])
    })
    setupTextDocumentUpdater(Uri.parse(uri), doc)
  }

  useTextDocumentWatcher(
    (document) => {
      if (document.uri.scheme === CustomUriScheme) {
        const uri = document.uri.toString()
        const file = files.get(uri)
        if (file) return file.doc
        trackContent(uri)
      }
    },
    () => isPermissionLocked.value,
    syncAux,
    async (document) => {
      const file = files.get(document.uri.toString())
      if (file && file.lastSafeText !== undefined) {
        // Usa o override temporal para reverter a alteracao nao-autorizada na tela
        isSystemOverride.value = true;
        try {
          const edit = new WorkspaceEdit()
          const fullRange = new Range(new Position(0, 0), document.lineAt(document.lineCount > 0 ? document.lineCount - 1 : 0).range.end)
          edit.replace(document.uri, fullRange, file.lastSafeText)
          await workspace.applyEdit(edit)
          await document.save()
        } finally {
          isSystemOverride.value = false;
        }
      }
    }
  )

  useDisposable(workspace.onDidOpenTextDocument(({ uri }) => {
    if (uri.scheme === CustomUriScheme) trackContent(uri.toString())
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
    if (autoSave.value) return
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

  let isGlobalLocked = true;
  let isVip = false;

  function atualizarCadeado() {
    const estavaTrancado = isPermissionLocked.value;
    isPermissionLocked.value = isGlobalLocked && !isVip;

    if (estavaTrancado !== isPermissionLocked.value) {
      if (isPermissionLocked.value) {
        window.showWarningMessage("O Professor ativou o Modo Controle. Você agora é Somente Leitura.");
      } else {
        window.showInformationMessage("Modo de Edição liberado para você!");
      }
      const mudancas = Array.from(files.keys()).map(uriStr => ({ uri: Uri.parse(uriStr), type: 2 }));
      if (mudancas.length > 0) fileChanged(mudancas);
    }
  }

  const [___, recvPermissions] = connection.makeAction<string[]>(UpdatePermissionsAction)
  recvPermissions((allowedPeers) => {
    isVip = allowedPeers.includes(connection.selfId);
    atualizarCadeado();
  })

  const [____, recvGlobalLock] = connection.makeAction<boolean>(UpdateGlobalLockAction)
  recvGlobalLock((locked) => {
    isGlobalLocked = locked;
    atualizarCadeado();
  })
  
  const [_____, recvForceSync] = connection.makeAction<void>(ForceSyncAction)
  recvForceSync(async () => {
    window.showWarningMessage("Sincronização forçada pelo Professor. Revertendo e nivelando arquivos...");
    await syncAux();
  })

  useSetActiveProvider({
    watch(uri_, options) {
      const handle = rpc.fsWatch(connection.selfId, uri_.toString(), options)
      return { async dispose() { await rpc.fsUnwatch(await handle) } }
    },
    async stat(uri) {
      const file = files.get(uri.toString())
      const permissoes = isReadonly.value ? 1 : undefined; // Obedece estritamente à trava fisica!

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
    async readDirectory(uri) { return handleFsError(await rpc.fsReadDirectory(uri.toString())) },
    async createDirectory(uri) { return handleFsError(await rpc.fsCreateDirectory(uri.toString())) },
    async readFile(uri) { return handleFsError(await rpc.fsReadFile(uri.toString())) },
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
    async delete(uri, options) { return handleFsError(await rpc.fsDelete(uri.toString(), options)) },
    async rename(oldUri, newUri, options) { return handleFsError(await rpc.fsRename(oldUri.toString(), newUri.toString(), options)) },
  })
}