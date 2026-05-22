import type { Diagnostic } from 'vscode'
import type { Connection } from '../sync/connection'
import type { TrackedDiagnostics } from './common'
import { useDisposable } from 'reactive-vscode'
import { languages } from 'vscode'
import { createConverter } from 'vscode-languageclient/$test/common/codeConverter'
import * as Y from 'yjs'

export function useHostDiagnostics(connection: Connection, doc: Y.Doc) {
  const c2p = createConverter(uri => (connection.toTrackUri(uri) ?? uri).toString())
  const diagnostics = doc.getMap<TrackedDiagnostics>('diagnostics')

  for (const [uri_, diags] of languages.getDiagnostics()) {
    const uri = connection.toTrackUri(uri_)
    if (!uri)
      continue
    for (const d of diags) {
      addDiagnostic(uri.toString(), d)
    }
  }

  useDisposable(languages.onDidChangeDiagnostics(({ uris }) => {
    doc.transact(() => {
      for (const uri_ of uris) {
        const uri = connection.toTrackUri(uri_)
        if (!uri)
          continue
        for (const diags of diagnostics.values()) {
          diags.delete(uri.toString())
        }
        for (const diag of languages.getDiagnostics(uri_)) {
          addDiagnostic(uri.toString(), diag)
        }
      }
    })
  }))

  function addDiagnostic(uri: string, diag: Diagnostic) {
    const source = diag.source || ''
    let diags = diagnostics.get(source)
    if (!diags) {
      diags = new Y.Map()
      diagnostics.set(source, diags)
    }
    diags.set(uri, [
      ...(diags.get(uri) || []),
      c2p.asDiagnostic(diag),
    ])
  }
}
