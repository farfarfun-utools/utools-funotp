import type { FunOtpState } from './state'

export function listOtpAccounts(state: FunOtpState, keyword: unknown = '') {
  const query = typeof keyword === 'string' ? keyword.trim().toLocaleLowerCase() : ''
  const matched = state.accounts.filter(account => !account.deletedAt
    && (!query || `${account.issuer || ''} ${account.name || ''}`.toLocaleLowerCase().includes(query)))
  return {
    total: matched.length,
    accounts: matched.slice(0, 50).map(account => ({ id: account.id, issuer: account.issuer || '', name: account.name || '' })),
  }
}
