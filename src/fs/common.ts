/*
 * Arquivo: common.ts
 * * Objetivo Principal:
 * Fazer a ponte bidirecional entre o editor visual do VS Code e a memoria local sincronizada do Y.js.
 * * Como funciona:
 * 1. VS Code -> Y.js (useTextDocumentWatcher): Se o usuario digitar no VS Code, captura as letras e injeta no Y.Doc local.
 * 2. Y.js -> VS Code (setupTextDocumentUpdater): Se chegar atualizacao da rede (Y.js mudou), injeta essas mudancas no VS Code para atualizar a tela.
 * * Ponto Critico:
 * Possui controle de bloqueio para impedir que digitações locais de alunos travados poluam a árvore do Y.js e quebrem a sincronizacao.
 */

import type { FileChangeType, TextDocument, TextDocumentChangeReason, Uri } from 'vscode'
import type * as Y from 'yjs'
import { useDisposable } from 'reactive-vscode'
import { FileSystemError, Range, window, workspace, WorkspaceEdit } from 'vscode'

export type FilesMap = Y.Map<Y.Doc>
export interface TrackContentRequest { guestId: string, uri: string, content?: string }
export interface FileChangeEvent { uri: string, type: FileChangeType }

// Mapa que guarda quais arquivos estao sendo alterados pelo sistema neste exato momento (nao pelo usuario).
// Serve para evitar loops infinitos onde o VS Code notifica alteracao, o Y.js recebe, devolve pro VS Code que notifica de novo.
const editingUris = new Map<string, number>()

/*
 * Ouve o VS Code e atualiza o Y.js.
 * Capta cada letra digitada ou apagada na tela.
 */
export function useTextDocumentWatcher(
  getDoc: (document: TextDocument) => Y.Doc | null | undefined,
  isLocked?: () => boolean, // Trava injetada para verificar se o modo read-only esta ativo.
  syncAux?: () => Promise<void>, // Funcao de sincronizacao auxiliar
  onLockedChange?: (document: TextDocument) => void // Funcao de rollback (apaga a letra que o usuario digitou escondido).
) {
  useDisposable(workspace.onDidChangeTextDocument(({ document, contentChanges, reason }) => {
    // Se o arquivo esta sendo atualizado pelo codigo (rede) ou se nao teve mudanca, ignora para evitar loop de eventos.
    if (contentChanges.length === 0 || editingUris.has(document.uri.toString())) {
      return
    }

    
    // A Porta da Frente: Se o usuario esta travado, bloqueamos a entrada.
    if (isLocked && isLocked()) {
      if (onLockedChange) {
        onLockedChange(document) // Aciona o rollback visual.
      }
      if (syncAux) {
        syncAux() // Força a sincronização e o salvamento para limpar o estado "dirty".
      }
      return // Mata o processamento aqui, salvando a integridade do Y.js.
    }
    // Se chegou aqui, o usuario tem permissão para editar. Vamos injetar as mudancas no Y.js.
    const doc = getDoc(document)
    if (!doc) {
      // Se o documento nao esta sendo monitorado pelo Y.js, ignora.
      return
    }

    // Injeta as mudancas do VS Code na memoria do Y.js.
    doc.transact(() => {
      const text = doc.getText()
      
      // Ordena as mudancas de tras pra frente (do fim pro comeco do arquivo).
      // Isso impede que apagar letras mude os indices das alteracoes subsequentes.
      const sortedChanges = contentChanges.slice().sort((a, b) => b.rangeOffset - a.rangeOffset)
      
      for (const change of sortedChanges) {
        text.delete(change.rangeOffset, change.rangeLength)
        text.insert(change.rangeOffset, change.text)
      }
    }, { reason })
  }))
}

/*
 * Ouve o Y.js e atualiza o VS Code.
 * Acionado toda vez que uma atualizacao chega da rede e altera o documento do Y.js.
 */
export function setupTextDocumentUpdater(uri_: Uri, doc: Y.Doc) {
  doc.getText().observe((event) => {
    // Se a alteracao veio do proprio usuario (local), ignora. 
    // So nos importa se veio da rede.
    if (event.transaction.local)
      return
    
    // Repassa o "delta" (a diferenca exata: o que foi inserido ou deletado) para atualizar a tela.
    applyTextDocumentDelta(uri_, event.delta, event.transaction.origin?.reason)
  })
}

/*
 * Aplica as alteracoes vindas do Y.js na interface do VS Code de forma sequencial.
 */
const applyTextDocumentDelta = createSequentialFunction(async (uri: Uri, delta: Y.YEvent<any>['delta'], _reason: TextDocumentChangeReason | undefined) => {
  try {
    // Marca que esse arquivo esta sendo alterado pelo sistema.
    // Isso avisa o useTextDocumentWatcher para ignorar o evento do VS Code que isso vai gerar.
    editingUris.set(uri.toString(), (editingUris.get(uri.toString()) ?? 0) + 1)

    // Tenta atualizar usando o editor aberto (se o arquivo estiver visivel na tela).
    const editor = window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString())
    if (editor) {
      const doc = editor.document
      await editor.edit((edits) => {
        let index = 0 // Ponteiro de posicao atual no texto.
        
        // Aplica o Delta gerado pelo Y.js.
        for (const d of delta) {
          if (d.retain) {
            index += d.retain // Retain significa "pula X caracteres, mantendo-os intactos".
          }
          else if (d.insert) {
            const insert = d.insert as string
            edits.insert(doc.positionAt(index), insert)
          }
          else if (d.delete) {
            edits.delete(new Range(
              doc.positionAt(index),
              doc.positionAt(index + d.delete),
            ))
            index += d.delete
          }
        }
      }, {
        // Desativa pontos de Undo para essas alteracoes de rede, 
        // evitando que o Ctrl+Z do usuario apague o que o professor fez.
        undoStopBefore: false,
        undoStopAfter: false,
      })
      return
    }

    // Caso de Fallback: Se o arquivo nao esta visivel, atualiza nos bastidores.
    // Usamos WorkspaceEdit porque o arquivo pode ter edicoes nao salvas.
    const doc = await workspace.openTextDocument(uri)
    const edits = new WorkspaceEdit()
    let index = 0
    for (const d of delta) {
      if (d.retain) {
        index += d.retain
      }
      else if (d.insert) {
        const insert = d.insert as string
        edits.insert(uri, doc.positionAt(index), insert)
      }
      else if (d.delete) {
        edits.delete(uri, new Range(
          doc.positionAt(index),
          doc.positionAt(index + d.delete),
        ))
        index += d.delete
      }
    }
    await workspace.applyEdit(edits)
  }
  finally {
    // Diminui o contador de edicoes do sistema. Se chegar a 0, remove o arquivo do mapa.
    // Isso libera o useTextDocumentWatcher para voltar a escutar o usuario.
    const count = (editingUris.get(uri.toString()) ?? 1) - 1
    if (count <= 0)
      editingUris.delete(uri.toString())
    else
      editingUris.set(uri.toString(), count)
  }
})

/*
 * Helper de Fila Assincrona (Mutex).
 * Garante que promessas sejam executadas uma de cada vez, na ordem,
 * impedindo que duas alteracoes de rede atropelem a mesma linha do VS Code ao mesmo tempo.
 */
function createSequentialFunction<T extends (...args: any[]) => Promise<any>>(fn: T): T {
  let lastPromise: Promise<any> = Promise.resolve()
  return ((...args) => lastPromise = lastPromise.then(() => fn(...args))) as T
}

/*
 * Forca a sobreposicao do texto inteiro no Y.Doc.
 * Usado geralmente quando se abre um arquivo ou se forca uma sincronizacao absoluta.
 */
export function forceUpdateContent(uri: Uri | string, doc: Y.Doc, content: Uint8Array) {
  const newText = new TextDecoder().decode(content)
  const oldText = doc.getText().toString()
  
  if (oldText !== newText) {
    doc.transact(() => {
      const text = doc.getText()
      text.delete(0, text.length) // Apaga tudo
      text.insert(0, newText) // Cola o novo
    })
    console.warn('External edit to', uri.toString())
  }
}

interface FsResult<T> { ok?: T, err?: string }

/*
 * Embrulha funcoes de sistema de arquivos para tratar erros sem crashar a extensao.
 * Converte erros do FileSystem em um objeto seguro { err: code }.
 */
export function fsErrorWrapper<A extends any[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<FsResult<R>> {
  return async (...args) => {
    try {
      return { ok: await fn(...args) }
    }
    catch (e) {
      if (e instanceof FileSystemError)
        return { err: e.code }
      throw e
    }
  }
}

/*
 * Desembrulha o resultado seguro, lancando o erro real para o VS Code caso necessario.
 */
export function handleFsError<T>(result: FsResult<T>): T {
  if (result.err) {
    const factory = FileSystemError[result.err as keyof typeof FileSystemError] as any
    if (typeof factory !== 'function')
      throw new Error(`Unknown FileSystemError code: ${result.err}`)
    throw factory() // Dispara o erro de sistema (ex: FileNotFound)
  }
  return result.ok!
}