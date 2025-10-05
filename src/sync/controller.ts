export enum ControllerEvent {
  Data = 0,
  Ack = 1,
  Custom = 2,
}

export type ControllerMeta = {
  ctrl: ControllerEvent.Data
  gsn: number
} | {
  ctrl: ControllerEvent.Ack
  applied: number
  received: number[]
} | {
  ctrl: ControllerEvent.Custom
  [key: string]: any
}

export function useSyncController<M>(
  send: (data: Uint8Array, metadata: M & ControllerMeta) => void,
  recv: (data: Uint8Array, metadata: M) => void,
): {
  send: (data: Uint8Array | null, metadata: M) => void
  recv: (data: Uint8Array, metadata: M & ControllerMeta) => void
  cleanup: () => void
} {
  // Sending
  let selfGsn = 0
  let checking = false
  let suspendedAt: number | null = null
  const pendingUpdates = new Map<number, {
    timestamp: number
    data: Uint8Array
    metadata: M
  }>()
  async function intervalCheck() {
    if (checking) {
      return
    }
    checking = true
    try {
      if (lastSeen < Date.now() - 10000) {
        suspendedAt = Date.now()
        return
      }
      if (suspendedAt) {
        if (lastSeen > suspendedAt) {
          suspendedAt = null
        }
        else {
          return
        }
      }
      send(new Uint8Array(), {
        ctrl: ControllerEvent.Ack,
        applied: lastApplied,
        received: [...notApplied.keys()],
      })
    }
    finally {
      checking = false
    }
  }
  const intervalId = setInterval(intervalCheck, 2000)

  // Receiving
  let lastApplied = -1
  const notApplied = new Map<number, {
    data: Uint8Array
    metadata: M
  }>()
  let lastSeen = Date.now()
  function tryApplyUpdates() {
    while (true) {
      const data = notApplied.get(lastApplied + 1)
      if (!data) {
        break
      }
      recv(data.data, data.metadata)
      lastApplied++
      notApplied.delete(lastApplied)
    }
  }

  return {
    send(data, metadata) {
      data = data || new Uint8Array()
      selfGsn++
      send(data, {
        ...metadata,
        ctrl: ControllerEvent.Data,
        gsn: selfGsn,
      })
      pendingUpdates.set(selfGsn, {
        timestamp: Date.now(),
        data,
        metadata,
      })
    },
    recv(data, metadata) {
      const { ctrl: event } = metadata
      if (event === ControllerEvent.Data) {
        const { gsn } = metadata
        if (lastApplied === -1) {
          lastApplied = gsn - 1
        }
        lastSeen = Date.now()
        if (gsn <= lastApplied) {
          return
        }
        notApplied.set(gsn, {
          data: data!,
          metadata,
        })
        tryApplyUpdates()
        if (notApplied.size > 0) {
          console.warn('data packs not applied:', [...notApplied.keys()])
        }
      }
      else if (event === ControllerEvent.Ack) {
        const { applied, received } = metadata
        lastSeen = Date.now()
        for (const [gsn, info] of pendingUpdates) {
          if (applied >= gsn || received.includes(gsn)) {
            pendingUpdates.delete(gsn)
          }
          else if (Date.now() - info.timestamp > 2000) {
            send(info.data, {
              ...info.metadata,
              ctrl: ControllerEvent.Data,
              gsn,
            })
            info.timestamp = Date.now()
          }
        }
      }
      else {
        recv(data!, metadata)
      }
    },
    cleanup() {
      clearInterval(intervalId)
    },
  }
}
