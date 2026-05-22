// import type { DataPayload, JsonValue, TargetPeers } from '../connection'

// export interface UplinkMessageContent {
//   action: string
//   data: DataPayload
//   targetPeers?: TargetPeers
//   metadata?: JsonValue
// }

// export interface DownlinkMessageContent {
//   action: string
//   data?: DataPayload
//   peerId: string
//   metadata?: JsonValue
// }

// export const serializeUplink = serialize<UplinkMessageContent>
// export const deserializeUplink = deserialize<UplinkMessageContent>

// export const serializeDownlink = serialize<DownlinkMessageContent>
// export const deserializeDownlink = deserialize<DownlinkMessageContent>

// function serialize<T extends { data?: DataPayload }>(content: T): ArrayBuffer | string {
//   if (content.data instanceof Uint8Array) {
//     const metadata = JSON.stringify({
//       ...content,
//       data: undefined,
//     })
//     return packTextAndBuffer(metadata, content.data).buffer
//   }
//   else {
//     return JSON.stringify(content)
//   }
// }

// function deserialize<T extends { data?: DataPayload }>(input: ArrayBuffer | string): T {
//   if (input instanceof ArrayBuffer) {
//     const { buffer, text: metadata } = unpackTextAndBuffer(input)
//     return {
//       ...JSON.parse(metadata),
//       data: buffer,
//     } as unknown as T
//   }
//   else if (typeof input === 'string') {
//     return JSON.parse(input)
//   }
//   else {
//     throw new TypeError('Invalid input type for deserialization')
//   }
// }

// function packTextAndBuffer(text: string, data: Uint8Array) {
//   const metadataBuffer = new TextEncoder().encode(text)
//   const packed = new Uint8Array(4 + metadataBuffer.byteLength + data.byteLength)
//   const view = new DataView(packed.buffer)
//   view.setUint32(0, metadataBuffer.byteLength, true)
//   packed.set(metadataBuffer, 4)
//   packed.set(data, 4 + metadataBuffer.byteLength)
//   return packed
// }

// function unpackTextAndBuffer(packed: ArrayBufferLike) {
//   const view = new DataView(packed)
//   const metadataLength = view.getUint32(0, true)
//   const metadataBuffer = new Uint8Array(packed, 4, metadataLength)
//   const dataBuffer = new Uint8Array(packed, 4 + metadataLength)
//   const text = new TextDecoder().decode(metadataBuffer)
//   return { buffer: dataBuffer, text }
// }

// export const UpdatePeersAction = '__update_peers__'

// // Actions para mensagens customizadas devocto
// export const UpdatePermissionsAction = 'p2p-upd-perms'
// export const UpdateGlobalLockAction = 'p2p-upd-global-lock'
// export const ForceSyncAction = 'p2p-force-sync'


import type { DataPayload, JsonValue, TargetPeers } from '../connection'

export interface UplinkMessageContent {
  acao: string         // Mantendo o padrão em português que colocamos no Django
  uri?: string
  update?: string       // String em formato Base64 contendo os bytes do Y.js
  targetPeers?: TargetPeers
  metadata?: JsonValue
}

export interface DownlinkMessageContent {
  acao: string
  uri?: string
  update?: string       // String em formato Base64 enviada pelo Django
  peerId: string
  metadata?: JsonValue
}

/**
 * Converte um buffer Uint8Array do Y.js para String Base64 de forma eficiente
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  // Fallback caso rode puramente em ambientes sem o nó Buffer global
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return globalThis.btoa(binary);
}

/**
 * Converte uma String Base64 de volta para Uint8Array
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(base64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  // Fallback para ambientes web puros
  const binaryString = globalThis.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export const UpdatePeersAction = '__update_peers__'
export const UpdatePermissionsAction = 'p2p-upd-perms'
export const UpdateGlobalLockAction = 'p2p-upd-global-lock'
export const ForceSyncAction = 'p2p-force-sync'