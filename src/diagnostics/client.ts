import type { DiagnosticCollection } from 'vscode'
import type { Diagnostic } from 'vscode-languageclient'
import type * as Y from 'yjs'
import type { TrackedDiagnostics } from './common'
import { onScopeDispose } from 'reactive-vscode'
import { languages, Uri } from 'vscode'
import { createConverter } from 'vscode-languageclient/$test/common/protocolConverter'
import { useObserverDeep } from '../sync/doc'

export function useClientDiagnostics(doc: Y.Doc) {
  const diagnostics = doc.getMap<TrackedDiagnostics>('diagnostics')

  const collections = new Map<string, DiagnosticCollection>()
  onScopeDispose(() => {
    for (const collection of collections.values()) {
      collection.dispose()
    }
    collections.clear()
  })
  function getCollection(source: string) {
    let collection = collections.get(source)
    if (!collection) {
      collection = languages.createDiagnosticCollection(source || undefined)
      collections.set(source, collection)
    }
    return collection
  }
  async function setDiagnostics(collection: DiagnosticCollection, uri: string, diags: Diagnostic[]) {
    collection.set(Uri.parse(uri), await p2c.asDiagnostics(diags))
  }

  const p2c = createConverter(uri => Uri.parse(uri), true, true, true)

  useObserverDeep(
    () => diagnostics,
    (event) => {
      if (event.transaction.local) {
        return
      }

      if (event.path.length === 0) {
        for (const [source, { action }] of event.keys.entries()) {
          if (action === 'delete') {
            const collection = collections.get(source)
            if (collection) {
              collection.clear()
              collection.dispose()
              collections.delete(source)
            }
          }
          else {
            const newValue = diagnostics.get(source)!
            const collection = getCollection(source)
            newValue.forEach(async (diags, uri) => {
              setDiagnostics(collection, uri, diags)
            })
          }
        }
      }
      else {
        const source = event.path[0] as string
        const collection = getCollection(source)
        for (const [uri, { action }] of event.keys.entries()) {
          if (action === 'delete') {
            collection.set(Uri.parse(uri), [])
          }
          else {
            const newValue = diagnostics.get(source)!.get(uri)!
            setDiagnostics(collection, uri, newValue)
          }
        }
      }
    },
    (diagnostics) => {
      for (const [source, diags] of diagnostics) {
        const collection = getCollection(source)
        for (const [uri, diagnostics] of diags) {
          setDiagnostics(collection, uri, diagnostics)
        }
      }
    },
  )
}
