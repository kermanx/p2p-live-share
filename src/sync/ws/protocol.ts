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
    const metadata = JSON.stringify({
      ...content,
      data: undefined,
    })
    return packTextAndBuffer(metadata, content.data).buffer
  }
  else {
    return JSON.stringify(content)
  }
}

function deserialize<T extends { data?: DataPayload }>(input: ArrayBuffer | string): T {
  if (input instanceof ArrayBuffer) {
    const { buffer, text: metadata } = unpackTextAndBuffer(input)
    return {
      ...JSON.parse(metadata),
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

function packTextAndBuffer(text: string, data: Uint8Array) {
  const metadataBuffer = new TextEncoder().encode(text)
  const packed = new Uint8Array(4 + metadataBuffer.byteLength + data.byteLength)
  const view = new DataView(packed.buffer)
  view.setUint32(0, metadataBuffer.byteLength, true)
  packed.set(metadataBuffer, 4)
  packed.set(data, 4 + metadataBuffer.byteLength)
  return packed
}

function unpackTextAndBuffer(packed: ArrayBufferLike) {
  const view = new DataView(packed)
  const metadataLength = view.getUint32(0, true)
  const metadataBuffer = new Uint8Array(packed, 4, metadataLength)
  const dataBuffer = new Uint8Array(packed, 4 + metadataLength)
  const text = new TextDecoder().decode(metadataBuffer)
  return { buffer: dataBuffer, text }
}

export const UpdatePeersAction = '__update_peers__'
