import type { EffectScope, ShallowRef, WatchSource } from 'reactive-vscode'
import type { Connection } from './connection'
import { effectScope, onScopeDispose, readonly, ref, shallowReactive, shallowRef, watch } from 'reactive-vscode'
import * as Y from 'yjs'

export function useDocSync(connection: Connection, doc: Y.Doc) {
  const [send, recv] = connection.makeAction<Uint8Array>('doc')

  doc.on('updateV2', async (update: Uint8Array, origin: any) => {
    if (origin?.peerId) {
      return
    }
    await send(update)
  })

  recv((message, peerId) => {
    Y.applyUpdateV2(doc, message, { peerId })
  })
}

function createUseObserver(deep: boolean) {
  return <T extends Y.AbstractType<any>>(
    target: WatchSource<T | undefined>,
    observer: (events: Y.YEvent<any>, target: T) => void,
    init?: (target: T) => void,
  ) => {
    const versionCounter = ref(0)
    watch(target, (target, _, onCleanup) => {
      versionCounter.value++
      if (!target) {
        return
      }
      init?.(target)

      const wrappedObserver = (events: Y.YEvent<any> | Y.YEvent<any>[]) => {
        versionCounter.value++
        if (Array.isArray(events)) {
          for (const event of events) {
            observer(event, target)
          }
        }
        else {
          observer(events, target)
        }
      }
      if (deep) {
        target.observeDeep(wrappedObserver)
        onCleanup(() => target.unobserveDeep(wrappedObserver))
      }
      else {
        target.observe(wrappedObserver)
        onCleanup(() => target.unobserve(wrappedObserver))
      }
    }, { immediate: true })
    return versionCounter
  }
}

export const useObserverDeep = createUseObserver(true)
export const useObserverShallow = createUseObserver(false)

export function useShallowYMap<V>(map: WatchSource<Y.Map<V> | undefined>) {
  const result = shallowReactive(new Map<string, V>())
  useObserverShallow(map, (event) => {
    if (event.path.length !== 0) {
      console.warn('Ignoring non-top-level event in Y.Map', event)
      return
    }
    for (const [key, { action }] of event.keys) {
      if (action === 'delete') {
        result.delete(key)
      }
      else {
        result.set(key, event.target.get(key))
      }
    }
  }, (map) => {
    for (const [key, value] of map) {
      result.set(key, value)
    }
  })
  return readonly(result)
}

export function useShallowYMapKeyScopes<V>(
  map: WatchSource<Y.Map<V> | undefined>,
  fn: (key: string, value: ShallowRef<V>) => void,
) {
  const scopes = new Map<string, {
    scope: EffectScope
    value: ShallowRef<V>
  }>()

  onScopeDispose(() => {
    for (const { scope } of scopes.values()) {
      scope.stop()
    }
  })

  function add(key: string, value_: V) {
    const scope = effectScope(true)
    try {
      const value = shallowRef(value_)
      scope.run(() => fn(key, value))
      scopes.set(key, { scope, value })
    }
    catch (e) {
      scope.stop()
      throw e
    }
  }

  return useObserverShallow(
    map,
    (event, map) => {
      if (event.path.length !== 0) {
        console.warn('Ignoring non-top-level event in Y.Map', event)
        return
      }
      for (const [key, { action }] of event.keys) {
        if (action === 'add') {
          add(key, map.get(key)!)
        }
        else if (action === 'update') {
          const { value } = scopes.get(key)!
          value.value = map.get(key)!
        }
        else if (action === 'delete') {
          const entry = scopes.get(key)
          if (entry) {
            entry.scope.stop()
            scopes.delete(key)
          }
        }
      }
    },
    (map) => {
      for (const [key, value] of map) {
        add(key, value)
      }
    },
  )
}

export function useShallowYMapValueScopes<V>(
  map: WatchSource<Y.Map<V> | undefined>,
  fn: (key: string, value: V) => void,
) {
  const scopes = new Map<string, EffectScope>()

  onScopeDispose(() => {
    for (const scope of scopes.values()) {
      scope.stop()
    }
  })

  function add(key: string, value: V) {
    const scope = effectScope(true)
    scope.run(() => fn(key, value))
    scopes.set(key, scope)
  }

  function remove(key: string) {
    const scope = scopes.get(key)
    if (scope) {
      scope.stop()
      scopes.delete(key)
    }
  }

  return useObserverShallow(
    map,
    (event, map) => {
      if (event.path.length !== 0) {
        console.warn('Ignoring non-top-level event in Y.Map', event)
        return
      }
      for (const [key, { action }] of event.keys) {
        if (action !== 'add') {
          remove(key)
        }
        if (action !== 'delete') {
          add(key, map.get(key)!)
        }
      }
    },
    (map) => {
      for (const [key, value] of map) {
        add(key, value)
      }
    },
  )
}

export function useShallowYArray<T>(array: WatchSource<Y.Array<T> | undefined>) {
  const result = shallowRef<Array<T>>([])

  useObserverShallow(
    array,
    (_, array) => {
      result.value = array.toArray()
    },
    (array) => {
      result.value = array.toArray()
    },
  )

  return readonly(result)
}
