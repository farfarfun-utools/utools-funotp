import { expect, test } from 'vitest'
import { listOtpAccounts } from '../src/lib/ai-tools'
import { emptyState } from '../src/lib/state'

test('AI 仅获取账号标签，不获取密钥、动态码或备注', () => {
  const state = emptyState()
  state.accounts = [
    { id: 'a', issuer: 'GitHub', name: 'me', secret: 'TOPSECRET', note: 'private', groupIds: [] },
    { id: 'b', issuer: 'Bank', name: 'me', secret: 'BANKSECRET', groupIds: [], deletedAt: 1 },
  ]
  expect(listOtpAccounts(state, 'git')).toEqual({ total: 1, accounts: [{ id: 'a', issuer: 'GitHub', name: 'me' }] })
  expect(JSON.stringify(listOtpAccounts(state))).not.toContain('secret')
  expect(JSON.stringify(listOtpAccounts(state))).not.toContain('private')
})
