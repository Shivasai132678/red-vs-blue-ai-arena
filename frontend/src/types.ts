export type Source = 'azure' | 'local' | 'simulation'
export type CheckStatus = 'flagged' | 'passed' | 'error' | 'skipped'
export type Outcome = 'blocked' | 'allowed' | 'check_failed'
export type EvaluationStatus = 'queued' | 'checking' | 'completed' | 'check_failed'
export type Category =
  | 'normal_request'
  | 'direct_injection'
  | 'indirect_injection'
  | 'secret_extraction'
  | 'encoded_instruction'
  | 'benign_document'
  | 'custom'
export interface Expectation {
  outcome: 'blocked' | 'allowed'
  rationale: string
}
export interface Scenario {
  id: string
  name: string
  category: Category
  purpose: string
  prompt: string
  document: string | null
  expected: Expectation | null
}
export interface CheckResult {
  check_id: string
  name: string
  source: Source
  service: string
  order: number
  required: boolean
  status: CheckStatus
  reason: string
  details: Record<string, unknown>
  duration_ms: number
  error_code: string | null
}
export interface Evaluation {
  id: string
  batch_id: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  duration_ms: number | null
  status: EvaluationStatus
  scenario: { id: string | null; name: string; category: Category; purpose: string | null }
  prompt: string
  document: string | null
  expected: Expectation | null
  checks: CheckResult[]
  outcome: Outcome | null
  detected_by: string[]
  detection_sources: Source[]
  decision_reason: string | null
  application_action: string | null
  comparison: { result: 'match' | 'mismatch' | 'inconclusive' | 'not_defined'; note: string } | null
}
export interface StatusResponse {
  app: { name: string; version: string }
  azure: {
    configured: boolean
    endpoint_host: string | null
    verification: {
      state: 'unverified' | 'verified' | 'failed'
      checked_at: string | null
      message: string | null
    }
    blocklist: { name: string | null; exists: boolean | null }
  }
  checks: Array<{
    id: string
    name: string
    source: Source
    service: string
    description: string
    required: boolean
    configured: boolean
    order: number
  }>
  settings: { harm_threshold: number }
  model: { connected: false; note: string }
}
export interface ScenarioResponse {
  scenarios: Scenario[]
  categories: Record<Category, string>
}
export interface EvaluationFilters {
  category?: string
  outcome?: string
  source?: string
  batch_id?: string
}
export type CreateEvaluation =
  | { scenario_id: string }
  | { prompt: string; document?: string; label?: string; expected_outcome?: 'blocked' | 'allowed' }
