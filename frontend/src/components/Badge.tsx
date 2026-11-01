import type { CheckStatus, EvaluationStatus, Outcome, Source } from '../types'
const labels: Record<string, string> = {
  blocked: 'Blocked',
  allowed: 'Allowed',
  check_failed: 'Check failed',
  azure: 'Azure',
  local: 'Local rule',
  simulation: 'Simulation',
  queued: 'Queued',
  checking: 'Checking',
  completed: 'Completed',
  flagged: 'Flagged',
  passed: 'Passed',
  error: 'Error',
  skipped: 'Skipped',
  match: 'Match',
  mismatch: 'Mismatch',
  inconclusive: 'Inconclusive',
  not_defined: 'Not defined',
}
export function Badge({
  value,
}: {
  value:
    Outcome | Source | CheckStatus | EvaluationStatus | 'match' | 'mismatch' | 'inconclusive' | 'not_defined'
}) {
  return <span className={`badge badge-${value}`}>{labels[value]}</span>
}
