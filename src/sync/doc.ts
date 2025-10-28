import type { EffectScope, WatchSource } from 'reactive-vscode'
import type { Connection } from './connection'
import { effectScope, onScopeDispose, readonly, ref, shallowReactive, shallowRef, watch } from 'reactive-vscode'
import * as Y from 'yjs'

interface PeerInfo {
  peerId: string
  lastApplied: number
  notApplied: Map<number, Uint8Array>
  lastSeen: number
  cleanup: () => void
}

type Metadata = {
  event: 'update'
  gsn: number
} | {
  event: 'update-ack'
  applied: number
  received: number[]
}

export function useDocSync(connection: Connection, doc: Y.Doc) {
  const { peers } = connection
  const [send, recv] = connection.makeAction<Uint8Array, Metadata>('doc')

  const peerInfos = new Map<string, PeerInfo>()
  watch(peers, (newPeers) => {
    for (const [peerId, { cleanup }] of peerInfos) {
      if (!newPeers.includes(peerId)) {
        cleanup()
      }
    }
  }, { deep: true })
  onScopeDispose(() => {
    for (const { cleanup } of peerInfos.values()) {
      cleanup()
    }
  })

  function usePeer(peerId: string) {
    let peerInfo = peerInfos.get(peerId)
    if (!peerInfo) {
      let checking = false
      let suspendedAt: number | null = null
      async function intervalCheck() {
        if (checking) {
          return
        }
        checking = true
        try {
          if (peerInfo!.lastSeen < Date.now() - 10000) {
            console.warn('Peer', peerId, 'seems offline, suspending sync')
            suspendedAt = Date.now()
            return
          }
          if (suspendedAt) {
            if (peerInfo!.lastSeen > suspendedAt) {
              suspendedAt = null
            }
            else {
              return
            }
          }
          await send(new Uint8Array(), peerId, {
            event: 'update-ack',
            applied: peerInfo!.lastApplied,
            received: [...peerInfo!.notApplied.keys()],
          })
        }
        finally {
          checking = false
        }
      }

      const intervalId = setInterval(intervalCheck, 2000)
      function cleanup() {
        clearInterval(intervalId)
        peerInfos.delete(peerId)
        for (const [updateGsn, info] of pendingUpdates) {
          info.peers.delete(peerId)
          if (info.peers.size === 0) {
            pendingUpdates.delete(updateGsn)
          }
        }
      }

      peerInfos.set(peerId, peerInfo = {
        peerId,
        lastApplied: -1,
        notApplied: new Map(),
        lastSeen: Date.now(),
        cleanup,
      })
    }
    return peerInfo
  }

  let selfGsn = 0
  const pendingUpdates = new Map<number, {
    peers: Map<string, number>
    update: Uint8Array
  }>()
  doc.on('update', async (update: Uint8Array, origin: any) => {
    if (origin?.peerId) {
      return
    }

    const now = Date.now()
    const peersTable = new Map<string, number>()
    for (const peerId of peers.value) {
      usePeer(peerId)
      peersTable.set(peerId, now)
    }

    selfGsn++
    await send(update, null, { event: 'update', gsn: selfGsn })
    pendingUpdates.set(selfGsn, {
      peers: peersTable,
      update,
    })
  })

  function tryApplyUpdates(peerInfo: PeerInfo) {
    while (true) {
      const update = peerInfo.notApplied.get(peerInfo.lastApplied + 1)
      if (!update) {
        break
      }
      Y.applyUpdate(doc, update, peerInfo)
      peerInfo.lastApplied++
      peerInfo.notApplied.delete(peerInfo.lastApplied)
    }
  }

  recv(async (message, peerId, metadata) => {
    const event = metadata?.event
    if (event === 'update') {
      const { gsn } = metadata!
      const peerInfo = usePeer(peerId)
      if (peerInfo.lastApplied === -1) {
        peerInfo.lastApplied = gsn - 1
      }
      peerInfo.lastSeen = Date.now()
      if (gsn <= peerInfo.lastApplied) {
        return
      }
      peerInfo.notApplied.set(gsn, message)
      tryApplyUpdates(peerInfo)
      if (peerInfo.notApplied.size > 0) {
        console.warn('pending:', [...peerInfo.notApplied.keys()])
      }
    }
    else if (event === 'update-ack') {
      const { applied, received } = metadata!
      const peerInfo = peerInfos.get(peerId)
      if (peerInfo) {
        peerInfo.lastSeen = Date.now()
      }
      else {
        console.error('Received update-ack from unknown peer', peerId)
      }
      for (const [gsn, info] of pendingUpdates) {
        if (applied >= gsn || received.includes(gsn)) {
          info.peers.delete(peerId)
          if (info.peers.size === 0) {
            pendingUpdates.delete(gsn)
          }
        }
        else if (Date.now() - info.peers.get(peerId)! > 2000) {
          await send(info.update, peerId, { event: 'update', gsn })
          info.peers.set(peerId, Date.now())
        }
      }
    }
  })
}

function createUseObserver(deep: boolean) {
  return <T extends Y.AbstractType<any>>(
    target: WatchSource<T | undefined>,
    observer: (events: Y.YEvent<any>[], target: T) => void,
    init: (target: T) => void,
  ) => {
    const versionCounter = ref(0)
    watch(target, (target, _, onCleanup) => {
      versionCounter.value++
      if (!target) {
        return
      }
      init(target)

      const wrappedObserver = (events: Y.YEvent<any>[]) => {
        observer(events, target)
        versionCounter.value++
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
  useObserverShallow(
    map,
    (events) => {
      for (const event of events) {
        if (event.path.length !== 0) {
          console.warn('Ignoring non-top-level event in Y.Map', event)
          continue
        }
        for (const [key, { action }] of event.keys) {
          if (action === 'delete') {
            result.delete(key)
          }
          else {
            result.set(key, event.target.get(key))
          }
        }
      }
    },
    (map) => {
      for (const [key, value] of map) {
        result.set(key, value)
      }
    },
  )
  return readonly(result)
}

export function useShallowYMapScopes<V>(
  map: WatchSource<Y.Map<V> | undefined>,
  fn: (key: string, value: V) => void,
) {
  const scopes = shallowReactive(new Map<string, EffectScope>())

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

  useObserverShallow(
    map,
    (events) => {
      for (const event of events) {
        if (event.path.length !== 0) {
          console.warn('Ignoring non-top-level event in Y.Map', event)
          continue
        }
        for (const [key, { action }] of event.keys) {
          if (action !== 'add') {
            remove(key)
          }
          if (action !== 'delete') {
            add(key, event.target.get(key)!)
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
