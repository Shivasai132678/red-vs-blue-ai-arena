import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { evaluation, jsonResponse, queued, scenario, scenarios, status } from '../test/fixtures'
import type { Evaluation } from '../types'
import { ArenaView } from './ArenaView'

const failed: Evaluation = {
  ...evaluation,
  status: 'check_failed',
  outcome: 'check_failed',
  detected_by: [],
  detection_sources: [],
  checks: evaluation.checks.map((c) => ({ ...c, status: 'error', error_code: 'timeout' })),
  comparison: { result: 'inconclusive', note: 'A required check failed.' },
  application_action: 'Request withheld (fail closed): a required security check did not complete.',
}

function mockServer(result: Evaluation) {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/scenarios') return Promise.resolve(jsonResponse(scenarios))
    if (url === '/api/evaluations/batch' && init?.method === 'POST')
      return Promise.resolve(jsonResponse({ batch_id: 'b1', evaluations: [queued] }, 202))
    if (url.startsWith('/api/evaluations?batch_id=b1'))
      return Promise.resolve(jsonResponse({ evaluations: [result] }))
    return Promise.reject(new Error(`unexpected ${url}`))
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
})

async function playMatch() {
  render(<ArenaView status={status} statusError={null} verifying={false} onVerify={() => undefined} />)
  fireEvent.click(await screen.findByRole('button', { name: /Start match · 1 rounds/ }))
  for (let i = 0; i < 12; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })
  }
}

it('submits the selected scenarios as one batch', async () => {
  const fetch = mockServer(evaluation)
  await playMatch()
  const batchCall = fetch.mock.calls.find(([url]) => url === '/api/evaluations/batch')
  expect(JSON.parse(String(batchCall?.[1]?.body))).toEqual({ scenario_ids: [scenario.id] })
})

it('plays a blocked round and ends with a debrief instead of a winner', async () => {
  mockServer(evaluation)
  await playMatch()
  expect(screen.getByText(/Blue stopped 1 of 1 attacks/)).toBeInTheDocument()
  expect(screen.queryByText(/wins/i)).not.toBeInTheDocument()
  expect(screen.getByRole('meter', { name: /Red · attacker/ })).toHaveAttribute('aria-valuenow', '0')
  expect(screen.getByRole('meter', { name: /Blue · defender/ })).toHaveAttribute('aria-valuenow', '100')
})

it('shows a failed check as check failed and never as allowed or got through', async () => {
  mockServer(failed)
  await playMatch()
  expect(screen.getByText('No attack produced a verdict')).toBeInTheDocument()
  expect(screen.getByText(/1 check failures \(not counted as allowed\)/)).toBeInTheDocument()
  expect(screen.getByRole('meter', { name: /Blue · defender/ })).toHaveAttribute('aria-valuenow', '100')
  expect(screen.getByRole('meter', { name: /Red · attacker/ })).toHaveAttribute('aria-valuenow', '100')
})
