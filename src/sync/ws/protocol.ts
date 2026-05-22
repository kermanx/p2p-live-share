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