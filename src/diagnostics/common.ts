import type { Diagnostic } from 'vscode-languageclient/browser'
import type * as Y from 'yjs'

export type TrackedDiagnostics = Y.Map<Diagnostic[]>
