import { base32Encode, isValidSecret, normalizeSecret } from './base32'
import { DEFAULT_DIGITS, DEFAULT_PERIOD, normalizeDigits, normalizePeriod } from './otp'
import type { OtpAlgorithm } from './otp'
import type { Account } from './core'

const SUPPORTED_ALGORITHMS = new Set(['SHA1', 'SHA256', 'SHA512'])

function pickAlgorithm(value: unknown): OtpAlgorithm {
  const name = String(value || '').toUpperCase().replace(/[\s-]/g, '')
  return (SUPPORTED_ALGORITHMS.has(name) ? name : 'SHA1') as OtpAlgorithm
}

// 标签形如 "Issuer:account"，也可能只有账号名。冒号前后允许有空格。
function splitLabel(label: unknown) {
  const text = String(label || '').trim()
  const index = text.indexOf(':')
  if (index < 0) return { issuer: '', name: text }
  return { issuer: text.slice(0, index).trim(), name: text.slice(index + 1).trim() }
}

/** 解析标准 otpauth 链接为账号数据。
 * @param uri `otpauth://` 链接。
 * @returns 解析出的账号数据。
 * @throws 链接或密钥无效时抛出错误。
 */
export function parseOtpauthUri(uri: unknown): Account {
  const input = String(uri || '').trim()
  if (!/^otpauth:\/\//i.test(input)) throw new Error('不是 otpauth:// 链接')

  let url
  try {
    url = new URL(input)
  } catch {
    throw new Error('otpauth 链接格式不正确')
  }

  const type = url.host.toLowerCase() === 'hotp' ? 'hotp' : 'totp'
  let label = ''
  try {
    label = decodeURIComponent(url.pathname.replace(/^\//, ''))
  } catch {
    label = url.pathname.replace(/^\//, '')
  }
  const fromLabel = splitLabel(label)
  const secret = normalizeSecret(url.searchParams.get('secret'))
  if (!isValidSecret(secret)) throw new Error('链接里的密钥无效')

  const issuer = (url.searchParams.get('issuer') || fromLabel.issuer || '').trim()
  return {
    type,
    // 有的服务商只在标签里写服务名，有的只在 issuer 参数里写，两边都兜一下。
    // 标签写成 "openai:"（冒号后为空）时账号名就是空的，别把服务名重复填进去。
    issuer,
    name: fromLabel.name,
    secret,
    algorithm: pickAlgorithm(url.searchParams.get('algorithm')),
    digits: normalizeDigits(url.searchParams.get('digits') || DEFAULT_DIGITS),
    period: normalizePeriod(url.searchParams.get('period') || DEFAULT_PERIOD),
    counter: type === 'hotp' ? Math.max(0, Number(url.searchParams.get('counter')) || 0) : 0,
    encoding: String(url.searchParams.get('encoding') || '').toLowerCase() === 'steam' ? 'steam' : 'standard',
  }
}

/** 将账号数据编码为标准 otpauth 链接。
 * @param account 要导出的账号。
 * @returns `otpauth://` 链接。
 */
export function buildOtpauthUri(account: Account): string {
  const issuer = String(account.issuer || '').trim()
  const name = String(account.name || '').trim()
  const label = issuer ? `${encodeURIComponent(issuer)}:${encodeURIComponent(name)}` : encodeURIComponent(name || 'FunOTP')
  const params = new URLSearchParams({ secret: normalizeSecret(account.secret) })
  if (issuer) params.set('issuer', issuer)
  if (account.algorithm && account.algorithm !== 'SHA1') params.set('algorithm', account.algorithm)
  if (normalizeDigits(account.digits) !== DEFAULT_DIGITS) params.set('digits', String(normalizeDigits(account.digits)))
  if (account.type === 'hotp') params.set('counter', String(Number(account.counter) || 0))
  else if (normalizePeriod(account.period) !== DEFAULT_PERIOD) params.set('period', String(normalizePeriod(account.period)))
  if (account.encoding === 'steam') params.set('encoding', 'steam')
  return `otpauth://${account.type === 'hotp' ? 'hotp' : 'totp'}/${label}?${params}`
}

function readVarint(bytes: Uint8Array, cursor: { index: number }) {
  let value = 0n
  let shift = 0n
  while (cursor.index < bytes.length) {
    const byte = bytes[cursor.index]
    cursor.index += 1
    value |= BigInt(byte & 0x7f) << shift
    if (!(byte & 0x80)) return value
    shift += 7n
    if (shift > 63n) break
  }
  throw new Error('迁移数据已损坏')
}

// protobuf 的一个字段：varint 落在 value 上，length-delimited 落在 bytes 上。
interface WireField {
  field: number
  value?: bigint
  bytes?: Uint8Array
}

// 只认 protobuf 的 varint 和 length-delimited 两种线格式，其余按固定长度跳过。
function readFields(bytes: Uint8Array): WireField[] {
  const cursor = { index: 0 }
  const fields: WireField[] = []
  while (cursor.index < bytes.length) {
    const key = Number(readVarint(bytes, cursor))
    const field = key >>> 3
    const wire = key & 7
    if (wire === 0) fields.push({ field, value: readVarint(bytes, cursor) })
    else if (wire === 2) {
      const length = Number(readVarint(bytes, cursor))
      if (length < 0 || cursor.index + length > bytes.length) throw new Error('迁移数据已损坏')
      fields.push({ field, bytes: bytes.subarray(cursor.index, cursor.index + length) })
      cursor.index += length
    } else if (wire === 5) cursor.index += 4
    else if (wire === 1) cursor.index += 8
    else throw new Error('迁移数据已损坏')
  }
  return fields
}

function decodeBase64(value: unknown) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

// protobuf 里算法和位数是枚举下标，越界的值按默认值处理，所以这里按下标取。
const MIGRATION_ALGORITHMS: Record<number, string> = { 1: 'SHA1', 2: 'SHA256', 3: 'SHA512' }
const MIGRATION_DIGITS: Record<number, number> = { 1: 6, 2: 8 }

// Google Authenticator「导出账号」生成的二维码，内容是 protobuf 打包后的 base64。
/** 解析 Google Authenticator 迁移链接中的全部账号。
 * @param uri `otpauth-migration://` 链接。
 * @returns 解析出的账号列表。
 * @throws 链接或迁移数据无效时抛出错误。
 */
export function parseMigrationUri(uri: unknown): Account[] {
  const input = String(uri || '').trim()
  if (!/^otpauth-migration:\/\//i.test(input)) throw new Error('不是 otpauth-migration:// 链接')
  const data = new URL(input).searchParams.get('data')
  if (!data) throw new Error('迁移链接缺少 data 参数')

  const text = new TextDecoder()
  return readFields(decodeBase64(data))
    .filter(entry => entry.field === 1)
    .flatMap(entry => {
      if (!entry.bytes) return []
      const parameters = new Map<number, WireField>()
      for (const item of readFields(entry.bytes)) parameters.set(item.field, item)
      const secret = parameters.get(1)?.bytes
      if (!secret?.length) return []
      const type = Number(parameters.get(6)?.value ?? 2n) === 1 ? 'hotp' : 'totp'
      const name = text.decode(parameters.get(2)?.bytes || new Uint8Array())
      const issuer = text.decode(parameters.get(3)?.bytes || new Uint8Array())
      const fromLabel = splitLabel(name)
      return [{
        type,
        issuer: issuer || fromLabel.issuer,
        name: fromLabel.name,
        secret: base32Encode(secret),
        algorithm: MIGRATION_ALGORITHMS[Number(parameters.get(4)?.value ?? 1n)] || 'SHA1',
        digits: MIGRATION_DIGITS[Number(parameters.get(5)?.value ?? 1n)] || DEFAULT_DIGITS,
        period: DEFAULT_PERIOD,
        counter: type === 'hotp' ? Number(parameters.get(7)?.value ?? 0n) : 0,
        encoding: 'standard',
      }]
    })
}

// 从任意文本里捞出所有 otpauth 链接：可以是导出的 txt、也可以是扫码得到的一串内容。
/** 从文本中提取并解析全部 OTP 链接。
 * @param text 包含 OTP 链接的文本。
 * @returns 成功解析的账号和每条失败原因。
 */
export function parseOtpauthText(text: unknown): { accounts: Account[], errors: string[] } {
  const matches = String(text || '').match(/otpauth(-migration)?:\/\/\S+/gi) || []
  const accounts: Account[] = []
  const errors: string[] = []
  for (const uri of matches) {
    try {
      if (/^otpauth-migration:/i.test(uri)) accounts.push(...parseMigrationUri(uri))
      else accounts.push(parseOtpauthUri(uri))
    } catch (error) {
      errors.push(error.message)
    }
  }
  return { accounts, errors }
}
