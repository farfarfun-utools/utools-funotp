// RFC 4648 Base32。两步验证密钥全都以这种形式在服务商与验证器之间传递。
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

// 用户从网页上抄密钥时经常带上空格、连字符或小写，这里一并容忍。
/** 将用户输入规范化为无空白、无填充的大写 Base32 密钥。
 * @param value 待规范化的任意输入。
 * @returns 规范化后的密钥字符串。
 */
export function normalizeSecret(value: unknown): string {
  return String(value || '').toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '')
}

/** 解码 RFC 4648 Base32 密钥。
 * @param value Base32 密钥。
 * @returns 解码后的字节。
 * @throws 密钥为空、过短或含有非法字符时抛出错误。
 */
export function base32Decode(value: unknown): Uint8Array<ArrayBuffer> {
  const input = normalizeSecret(value)
  if (!input) throw new Error('请输入密钥')
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of input) {
    const index = ALPHABET.indexOf(char)
    if (index < 0) throw new Error('密钥只能包含 A-Z 和 2-7')
    buffer = (buffer << 5) | index
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >>> bits) & 0xff)
    }
  }
  if (!bytes.length) throw new Error('密钥太短，至少需要 2 个字符')
  return Uint8Array.from(bytes)
}

/** 将字节编码为无填充的 RFC 4648 Base32 字符串。
 * @param bytes 要编码的字节。
 * @returns Base32 字符串。
 */
export function base32Encode(bytes: Uint8Array): string {
  let output = ''
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      output += ALPHABET[(buffer >>> bits) & 31]
    }
  }
  if (bits) output += ALPHABET[(buffer << (5 - bits)) & 31]
  return output
}

/** 判断输入是否为可解码的 Base32 密钥。
 * @param value 待校验的输入。
 * @returns 密钥有效时为 `true`。
 */
export function isValidSecret(value: unknown): boolean {
  try {
    base32Decode(value)
    return true
  } catch {
    return false
  }
}
