import type { FileChangeEvent, FileSystemProvider } from 'vscode'
import { defineService, onScopeDispose, useDisposable, useEventEmitter } from 'reactive-vscode'
import { workspace } from 'vscode'

export const ClientUriScheme = 'p2p-live-share'

type FileSystemProviderImpl = Omit<FileSystemProvider, 'onDidChangeFile'>
interface DeferredWatch {
  args: Parameters<FileSystemProvider['watch']>
  dispose: () => void
  disposed: boolean
}

export const useFsProvider = defineService(() => {
  let resolveInit: () => void
  const initPromise = new Promise<void>(r => resolveInit = r)
  let deferredWatches: DeferredWatch[] = []

  let activeProvider: FileSystemProviderImpl | null = null
  const useSetActiveProvider = (provider: FileSystemProviderImpl) => {
    if (activeProvider) {
      throw new Error('Only one active FS provider is allowed')
    }
    activeProvider = provider
    onScopeDispose(() => activeProvider = null)
    resolveInit()

    for (const info of deferredWatches) {
      if (info.disposed)
        continue
      try {
        const disposable = provider.watch(...info.args)
        info.dispose = () => disposable.dispose()
      }
      catch (e) {
        console.error('Failed to process deferred watch', e)
      }
    }
    deferredWatches = []
  }

  function getHandler<K extends keyof FileSystemProviderImpl>(method: K) {
    return async (...args: any) => {
      await initPromise
      if (!activeProvider) {
        throw new Error('No active FS provider')
      }
      if (!activeProvider[method]) {
        throw new Error(`Active FS provider does not implement ${method}`)
      }
      return (activeProvider[method] as any)(...args)
    }
  }

  const fileChange = useEventEmitter<FileChangeEvent[]>()

  useDisposable(workspace.registerFileSystemProvider(
    ClientUriScheme,
    {
      onDidChangeFile: fileChange.event,
      watch: (...args) => {
        if (activeProvider) {
          return activeProvider.watch(...args)
        }
        else {
          const info: DeferredWatch = {
            args,
            disposed: false,
            dispose() {
              info.disposed = true
            },
          }
          deferredWatches.push(info)
          return {
            dispose() { info.dispose() },
          }
        }
      },
      stat: getHandler('stat'),
      readDirectory: getHandler('readDirectory'),
      createDirectory: getHandler('createDirectory'),
      readFile: getHandler('readFile'),
      writeFile: getHandler('writeFile'),
      delete: getHandler('delete'),
      rename: getHandler('rename'),
    },
    {
      // TODO:
      isCaseSensitive: true,
      isReadonly: false,
    },
  ))

  return {
    useSetActiveProvider,
    fileChanged: fileChange.fire,
  }
})
