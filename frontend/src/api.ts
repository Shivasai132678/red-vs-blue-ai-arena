import type {
  CreateEvaluation,
  Evaluation,
  EvaluationFilters,
  ScenarioResponse,
  StatusResponse,
} from './types'
export class ApiError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, init)
  } catch {
    throw new ApiError('network_error', 'Unable to reach the server. Check your connection and try again.', 0)
  }
  if (!response.ok) {
    let code = 'request_failed'
    let message = `Request failed (${response.status}).`
    try {
      const data: unknown = await response.json()
      if (typeof data === 'object' && data !== null && 'error' in data) {
        const error = data.error
        if (typeof error === 'object' && error !== null) {
          if ('code' in error && typeof error.code === 'string') code = error.code
          if ('message' in error && typeof error.message === 'string') message = error.message
        }
      }
    } catch {
      /* Retain the HTTP error when the body is unavailable. */
    }
    throw new ApiError(code, message, response.status)
  }
  if (response.status === 204) return undefined as T
  try {
    return (await response.json()) as T
  } catch {
    throw new ApiError('invalid_response', 'The server returned an invalid response.', response.status)
  }
}
const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  ...(body === undefined
    ? {}
    : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
})
export const api = {
  status: () => request<StatusResponse>('/status'),
  verify: () => request<StatusResponse>('/status/verify', post()),
  scenarios: () => request<ScenarioResponse>('/scenarios'),
  create: (body: CreateEvaluation) => request<Evaluation>('/evaluations', post(body)),
  batch: (ids: string[]) =>
    request<{ batch_id: string; evaluations: Evaluation[] }>(
      '/evaluations/batch',
      post({ scenario_ids: ids }),
    ),
  list: (filters: EvaluationFilters = {}) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => Boolean(value)))
    return request<{ evaluations: Evaluation[] }>(`/evaluations${query.size ? `?${query}` : ''}`)
  },
  evaluation: (id: string) => request<Evaluation>(`/evaluations/${encodeURIComponent(id)}`),
  clear: () => request<void>('/evaluations', { method: 'DELETE' }),
}
