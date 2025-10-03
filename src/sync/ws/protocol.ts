import type { DataPayload, JsonValue, TargetPeers } from '../connection'

export interface UplinkMessageContent {
  action: string
  data: DataPayload
  targetPeers?: TargetPeers
  metadata?: JsonValue
}

export interface DownlinkMessageContent {
  action: string
  data?: DataPayload
  peerId: string
  metadata?: JsonValue
}

export const serializeUplink = serialize<UplinkMessageContent>
export const deserializeUplink = deserialize<UplinkMessageContent>

export const serializeDownlink = serialize<DownlinkMessageContent>
export const deserializeDownlink = deserialize<DownlinkMessageContent>

function serialize<T extends { data?: DataPayload }>(content: T): ArrayBuffer | string {
  if (content.data instanceof Uint8Array) {
    return packBufferJson(content.data, {
      ...content,
      data: undefined,
    })
  }
  else {
    return JSON.stringify(content)
  }
}

function deserialize<T extends { data?: DataPayload }>(input: ArrayBuffer | string): T {
  if (input instanceof ArrayBuffer) {
    const { buffer, json } = unpackBufferJson(input)
    return {
      ...json,
      data: buffer,
    } as unknown as T
  }
  else if (typeof input === 'string') {
    return JSON.parse(input)
  }
  else {
    throw new TypeError('Invalid input type for deserialization')
  }
}

function packBufferJson(data: Uint8Array, metadata?: any) {
  const metadataBuffer = new TextEncoder().encode(JSON.stringify(metadata))
  const packed = new Uint8Array(4 + metadataBuffer.byteLength + data.byteLength)
  const view = new DataView(packed.buffer)
  view.setUint32(0, metadataBuffer.byteLength, true)
  packed.set(metadataBuffer, 4)
  packed.set(data, 4 + metadataBuffer.byteLength)
  return packed.buffer
}

function unpackBufferJson(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  const metadataLength = view.getUint32(0, true)
  const metadataBuffer = new Uint8Array(buffer, 4, metadataLength)
  const dataBuffer = new Uint8Array(buffer, 4 + metadataLength)
  const json = JSON.parse(new TextDecoder().decode(metadataBuffer))
  return { buffer: dataBuffer, json }
}

export const UpdatePeersAction = '__update_peers__'
