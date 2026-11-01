import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { evaluation, jsonResponse } from '../test/fixtures'
import { HistoryView } from './HistoryView'
beforeEach(() => {
  window.location.hash = '/log'
})
it('renders evaluation rows and requests the selected outcome filter', async () => {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ evaluations: [evaluation] })))
  vi.stubGlobal('fetch', fetch)
  render(<HistoryView />)
  expect(await screen.findByText('Instruction override')).toBeInTheDocument()
  expect(screen.getByText('Prompt Shields')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'blocked' } })
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/evaluations?outcome=blocked', undefined))
  expect(await screen.findByText('1 results')).toBeInTheDocument()
})
it('shows the initial empty state', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ evaluations: [] })))
  render(<HistoryView />)
  expect(await screen.findByText('No evaluations yet')).toBeInTheDocument()
})
it('shows a filtered-empty state', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ evaluations: [] }))),
  )
  render(<HistoryView />)
  await screen.findByText('No evaluations yet')
  fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'blocked' } })
  expect(await screen.findByText('No evaluations match')).toBeInTheDocument()
})
it('shows errors and supports retry', async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValue(jsonResponse({ evaluations: [] }))
  vi.stubGlobal('fetch', fetch)
  render(<HistoryView />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to reach the server')
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('No evaluations yet')).toBeInTheDocument()
})
it('loads directly linked evidence', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(jsonResponse(url.endsWith('/evaluation-1') ? evaluation : { evaluations: [] })),
      ),
  )
  render(<HistoryView evaluationId="evaluation-1" />)
  expect(await screen.findByText(evaluation.prompt)).toBeInTheDocument()
})
it('confirms deletion and reloads the list only after DELETE succeeds', async () => {
  const fetch = vi
    .fn()
    .mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : jsonResponse({ evaluations: [evaluation] }),
      ),
    )
  vi.stubGlobal('fetch', fetch)
  render(<HistoryView />)
  await screen.findByText('Instruction override')
  fireEvent.click(screen.getByRole('button', { name: 'Clear history' }))
  expect(screen.getByRole('dialog')).toHaveAttribute('open')
  expect(fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Delete all evaluations' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/evaluations', { method: 'DELETE' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
