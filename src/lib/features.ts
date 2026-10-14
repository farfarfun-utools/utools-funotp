// 「复制某个账号的验证码」这个 uTools 动态功能的 code 形如 copy-otp@<账号 id>。
// 这个前缀原来在 5 处被手写，解析时还配着一个与前缀长度耦合的 slice(9)——
// 改前缀就得同时改那个数字，漏一个就会注册上再也删不掉的关键字。
export const QUICK_FEATURE_PREFIX = 'copy-otp@'

/** 生成账号对应的动态功能 code。
 * @param accountId 账号标识。
 * @returns uTools 动态功能的 code。
 */
export function quickFeatureCode(accountId: string): string {
  return `${QUICK_FEATURE_PREFIX}${accountId}`
}

/** 从动态功能 code 中取回账号标识。
 * @param code uTools 动态功能的 code。
 * @returns 账号标识，不是本插件的关键字时返回空串。
 */
export function quickFeatureAccountId(code: unknown): string {
  const text = String(code || '')
  return text.startsWith(QUICK_FEATURE_PREFIX) ? text.slice(QUICK_FEATURE_PREFIX.length) : ''
}
