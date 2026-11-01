import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'
import { jsonResponse, status } from './test/fixtures'
afterEach(() => vi.unstubAllGlobals())
describe('API client', () => {
  it('parses a successful JSON response', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(status))
    vi.stubGlobal('fetch', fetch)
    expect(await api.status()).toEqual(status)
    expect(fetch).toHaveBeenCalledWith('/api/status', undefined)
  })
  it('preserves structured validation errors and HTTP status', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { code: 'validation_error', message: 'Prompt is too long.' } }, 422),
        ),
    )
    const result = api.create({ prompt: 'test' })
    await expect(result).rejects.toBeInstanceOf(ApiError)
    await expect(result).rejects.toMatchObject({
      code: 'validation_error',
      message: 'Prompt is too long.',
      status: 422,
    })
  })
  it('turns network errors into ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(api.status()).rejects.toMatchObject({ code: 'network_error', status: 0 })
  })
  it('handles delete responses without JSON and encodes filters', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ evaluations: [] }))
    vi.stubGlobal('fetch', fetch)
    await expect(api.clear()).resolves.toBeUndefined()
    await api.list({ outcome: 'blocked', source: 'azure', category: '' })
    expect(fetch).toHaveBeenLastCalledWith('/api/evaluations?outcome=blocked&source=azure', undefined)
  })
})
