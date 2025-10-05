import type { ControllerMeta } from '../sync/controller'

export enum SocketEventType {
  Connect = 0,
  Data = 1,
  End = 2,
  Close = 3,
}

export interface SocketEventMeta {
  socketId: string
  event: SocketEventType
}

export type SocketMeta = SocketEventMeta & ControllerMeta & {
  linkId: string
}

export interface ServerInfo {
  serverId: string
  peerId: string
  name: string
  host: string
  port: number
  createdAt: number
}
