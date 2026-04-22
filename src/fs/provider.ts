import type { FileChangeEvent, FileSystemProvider } from 'vscode'
import { defineService, onScopeDispose, useDisposable, useEventEmitter, shallowRef } from 'reactive-vscode'
import { workspace, FileSystemError } from 'vscode'

export const CustomUriScheme = 'p2p-live-share'


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

  // TRAVA DE SEGURANÇA (DEFAULT DENY)
  // Nasce bloqueado. Apenas o Host ou um pacote de permissão via rede pode mudar isso para false.
  const isReadonly = shallowRef(true)

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
    // esse método é chamado toda vez que o VS Code quer usar uma função do 
    // nosso FS, tipo stat, readFile, etc.
    return async (...args: any) => {
      await initPromise
      if (!activeProvider) {
        throw new Error('No active FS provider')
      }

      // --- O CADEADO DO DEVOCTO ---
      // Lista de métodos que alteram o disco.
      const mutativeMethods = ['writeFile', 'delete', 'rename', 'createDirectory']
      
      // Se a trava estiver ativa e o método for mutativo, barramos a ação na hora!
      if (isReadonly.value && mutativeMethods.includes(method)) {
        throw FileSystemError.NoPermissions('Sessão Bloqueada: O Professor (Host) restringiu a edição para você.')
      }

      if (!activeProvider[method]) {
        throw new Error(`Active FS provider does not implement ${method}`)
      }
      return (activeProvider[method] as any)(...args)
    }
  }

  const fileChange = useEventEmitter<FileChangeEvent[]>()

  useDisposable(workspace.registerFileSystemProvider(
    CustomUriScheme,
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
      isCaseSensitive: true,
      // deixamos isso como false para o VS Code tentar chamar o writeFile,
      // assim podemos disparar o nosso erro personalizado e bonitinho em vez 
      // de um erro genérico do VS Code.
      isReadonly: false, 
    },
  ))

  return {
    useSetActiveProvider,
    fileChanged: fileChange.fire,
    isReadonly, // EXPORTAMOS A TRAVA para podermos abrir/fechar via protocolo de rede
  }
})