export function serialize(data: any): Uint8Array | any {
  if (data.r instanceof Uint8Array) {
    const { t, i, r } = data
    const header = JSON.stringify({ t, i })
    const headerBytes = new TextEncoder().encode(header)
    const headerLength = headerBytes.length
    const result = new Uint8Array(4 + headerLength + r.length)
    new DataView(result.buffer).setUint32(0, headerLength, true)
    result.set(headerBytes, 4)
    result.set(r, 4 + headerLength)
    return result
  }
  else {
    return data
  }
}

export function deserialize(data: Uint8Array | any): any {
  if (data instanceof Uint8Array) {
    const headerLength = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true)
    const headerBytes = data.slice(4, 4 + headerLength)
    const header = new TextDecoder().decode(headerBytes)
    const { t, i } = JSON.parse(header)
    const r = data.slice(4 + headerLength)
    return { t, i, r }
  }
  else {
    return data
  }
}
