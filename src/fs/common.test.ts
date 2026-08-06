import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

/**
 * 模拟 forceUpdateContent 中的解码逻辑
 * 原代码: new TextDecoder().decode(content) — 默认 UTF-8，GB2312 会乱码
 * 修复后: 先 UTF-8，检测到大量替换字符时 fallback 到 GBK
 */
function decodeFileContent(content: Uint8Array): string {
  // 先尝试 UTF-8 严格解码
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content)
  }
  catch {
    // UTF-8 解码失败（包含非法字节序列），尝试 GBK/GB2312
    try {
      return new TextDecoder('gbk').decode(content)
    }
    catch {
      // GBK 也不可用时，回退到宽松 UTF-8
      return new TextDecoder('utf-8', { fatal: false }).decode(content)
    }
  }
}

describe('GB2312/GBK encoding handling', () => {
  it('decodes UTF-8 content correctly', () => {
    const text = 'Hello世界Test测试'
    const utf8Bytes = new TextEncoder().encode(text)
    const result = decodeFileContent(utf8Bytes)
    assert.equal(result, text)
  })

  it('falls back to GBK when UTF-8 produces replacement characters', () => {
    // "你好" in GBK/GB2312: C4 E3 BA C3
    const gbkBytes = new Uint8Array([0xC4, 0xE3, 0xBA, 0xC3])
    const result = decodeFileContent(gbkBytes)
    assert.equal(result, '你好', `Expected "你好", got "${result}"`)
  })

  it('handles ASCII-only content without fallback', () => {
    const text = 'Hello World 123'
    const bytes = new TextEncoder().encode(text)
    const result = decodeFileContent(bytes)
    assert.equal(result, text)
  })

  it('handles mixed Chinese GBK content', () => {
    // "中文GBK测试" in GBK
    // 中 = D6 D0, 文 = CE C4, G=47, B=42, K=4B, 测 = B2 E2, 试 = CA D4
    const gbkMixed = new Uint8Array([
      0xD6, 0xD0, // 中
      0xCE, 0xC4, // 文
      0x47, 0x42, 0x4B, // GBK (ASCII)
      0xB2, 0xE2, // 测
      0xCA, 0xD4, // 试
    ])
    const result = decodeFileContent(gbkMixed)
    assert.equal(result, '中文GBK测试', `Expected "中文GBK测试", got "${result}"`)
  })

  it('falls back to GBK for pure GBK content (not mixed UTF-8+broken bytes)', () => {
    // 真实场景：一个纯 GBK 编码的文本文件
    // "中文内容测试" 的 GBK 编码
    const gbkContent = new Uint8Array([
      0xD6, 0xD0, 0xCE, 0xC4, // 中文
      0xC4, 0xDA, 0xC8, 0xDD, // 内容
      0xB2, 0xE2, 0xCA, 0xD4, // 测试
    ])
    const result = decodeFileContent(gbkContent)
    assert.equal(result, '中文内容测试', `Expected "中文内容测试", got "${result}"`)
  })

  it('handles empty content', () => {
    const result = decodeFileContent(new Uint8Array(0))
    assert.equal(result, '')
  })
})
