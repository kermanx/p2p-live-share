import type * as Y from 'yjs'
import type { Delta } from './delta'
import type { DocUndoManager, UndoChange, UndoSelection } from './undo-manager'
import { changesToDelta, deltaToChanges, diffToDelta, fromYDelta, transform, transformPosition } from './delta'

// The editor side, e.g. a `TextDocument`
export interface TextBuffer {
  readonly version: number
  getText: () => string
  // Resolves the new version, or `false` if not applied (e.g. buffer changed in the meantime)
  applyChanges: (changes: UndoChange[], version: number) => Promise<number | false>
}

// From `onDidChangeTextDocument`
export interface BufferChangeEvent {
  // Version after the change
  version: number
  changes: readonly UndoChange[]
  // Selections before the change
  selections?: readonly UndoSelection[]
}

export interface TextDocumentSyncOptions {
  echoTimeout?: number
  onDivergence?: (bufferText: string, text: string) => void
}

const MAX_APPLY_ATTEMPTS = 10
const MAX_RECONCILES = 3

// Remote changes reach the Y.Text immediatly but the buffer only later, so always
// `Y.Text = buffer + pending`. Local changes are transformed against `pending` before
// applying them to the Y.Text. Our own edits are recognised by there version, so
// local changes during a edit don't get dropped
export class TextDocumentSync {
  private pending: Delta[] = []
  // Changes recieved while a edit is in flight
  private deferred?: BufferChangeEvent[]
  // Applied edit, but its change event did not arrive yet
  private echoVersion?: number
  private onEcho?: () => void
  private running?: Promise<void>
  private disposed = false

  constructor(
    private readonly text: Y.Text,
    private readonly undoManager: DocUndoManager,
    private readonly openBuffer: () => Promise<TextBuffer | undefined>,
    private readonly options: TextDocumentSyncOptions = {},
  ) {
    text.observe(this.observer)
  }

  private readonly observer = (event: Y.YTextEvent) => {
    // Local changes already are in the buffer, except undo/redo
    if (event.transaction.local && event.transaction.origin !== this.undoManager)
      return
    this.pending.push(fromYDelta(event.delta))
    this.schedule()
  }

  handleBufferChange(event: BufferChangeEvent) {
    if (this.disposed || event.changes.length === 0)
      return
    if (this.deferred) {
      this.deferred.push(event)
      return
    }
    if (this.echoVersion !== undefined && event.version >= this.echoVersion) {
      const isEcho = event.version === this.echoVersion
      this.echoVersion = undefined
      this.onEcho?.()
      if (isEcho)
        return
    }
    this.applyLocalChange(event)
  }

  flush(): Promise<void> {
    return this.running ?? Promise.resolve()
  }

  dispose() {
    this.disposed = true
    this.text.unobserve(this.observer)
    this.echoVersion = undefined
    this.onEcho?.()
  }

  private applyLocalChange({ changes, selections }: BufferChangeEvent) {
    let local = changesToDelta(changes)
    const mappedSelections = selections?.map(({ anchor, active }) => ({
      anchor: this.pending.reduce((index, delta) => transformPosition(delta, index), anchor),
      active: this.pending.reduce((index, delta) => transformPosition(delta, index), active),
    }))
    for (let i = 0; i < this.pending.length; i++) {
      const remote = this.pending[i]
      // Remote inserts at the same offset go first on both side
      this.pending[i] = transform(local, remote, false)
      local = transform(remote, local, true)
    }
    const localChanges = deltaToChanges(local)
    if (localChanges.length)
      this.undoManager.applyChanges(localChanges, mappedSelections)
  }

  private schedule() {
    if (!this.running && !this.disposed) {
      this.running = this.run()
        .catch(e => console.error('Failed to sync text document:', e))
        .finally(() => this.running = undefined)
    }
  }

  private async run() {
    let failures = 0
    let reconciles = 0
    while (!this.disposed) {
      if (this.echoVersion !== undefined) {
        await this.waitForEcho()
        continue
      }
      const buffer = await this.openBuffer()
      if (!buffer || this.disposed)
        return
      if (this.pending.length === 0) {
        // Should not happen, but if a change got lost the Y.Text wins since all peers share it
        const bufferText = buffer.getText()
        const text = this.text.toString()
        if (bufferText === text)
          return
        this.options.onDivergence?.(bufferText, text)
        if (++reconciles > MAX_RECONCILES) {
          console.warn('Could not reconcile editor buffer with shared text')
          return
        }
        console.warn('Editor buffer out of sync with shared text, reconciling')
        this.pending.push(diffToDelta(bufferText, text))
        continue
      }
      if (await this.applyNext(buffer)) {
        failures = 0
      }
      else if (++failures >= MAX_APPLY_ATTEMPTS) {
        // Give up, the check above will replace the different range
        failures = 0
        this.pending = []
      }
      else {
        await new Promise(resolve => setTimeout(resolve, failures * 10))
      }
    }
  }

  private async applyNext(buffer: TextBuffer) {
    const changes = deltaToChanges(this.pending[0])
    if (changes.length === 0) {
      this.pending.shift()
      return true
    }
    const version = buffer.version
    this.deferred = []
    let result: number | false
    try {
      result = await buffer.applyChanges(changes, version)
    }
    catch (e) {
      console.warn('Failed to apply remote edit:', e)
      result = false
    }
    const events = this.deferred
    this.deferred = undefined
    if (result !== false) {
      this.pending.shift()
      if (result !== version) {
        const echo = events.findIndex(event => event.version === result)
        if (echo >= 0)
          events.splice(echo, 1)
        else
          this.echoVersion = result
      }
    }
    // If the edit failed all of them are local changes, the buffer doesnt have `pending[0]` yet
    for (const event of events)
      this.handleBufferChange(event)
    return result !== false
  }

  private waitForEcho() {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        console.warn('Did not receive the change event of a remote edit')
        this.echoVersion = undefined
        done()
      }, this.options.echoTimeout ?? 5000)
      const done = () => {
        clearTimeout(timer)
        this.onEcho = undefined
        resolve()
      }
      this.onEcho = done
    })
  }
}
