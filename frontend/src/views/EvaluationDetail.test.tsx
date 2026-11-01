import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { evaluation } from '../test/fixtures'
import { EvaluationDetail } from './EvaluationDetail'
it('shows full input, expectation, ordered checks, provenance, and verbatim application action', () => {
  render(<EvaluationDetail evaluation={evaluation} />)
  expect(screen.getByText(evaluation.prompt)).toBeInTheDocument()
  expect(screen.getByText(evaluation.document!)).toBeInTheDocument()
  expect(screen.getByText('Expected (policy)')).toBeInTheDocument()
  expect(screen.getByText('Match')).toBeInTheDocument()
  expect(screen.getByText(evaluation.comparison!.note, { exact: false })).toBeInTheDocument()
  const checks = screen.getAllByRole('listitem')
  expect(within(checks[0]!).getByText('Prompt Shields')).toBeInTheDocument()
  expect(within(checks[0]!).getByText('Azure')).toBeInTheDocument()
  expect(within(checks[1]!).getByText('Local rule')).toBeInTheDocument()
  expect(screen.getByText(evaluation.application_action!)).toBeInTheDocument()
  expect(screen.getByText('"detected": true', { exact: false })).toBeInTheDocument()
})
it('retains check error codes and distinguishes inconclusive outcomes', () => {
  render(
    <EvaluationDetail
      evaluation={{
        ...evaluation,
        outcome: 'check_failed',
        comparison: { result: 'inconclusive', note: 'Required service unavailable.' },
        checks: [{ ...evaluation.checks[0]!, status: 'error', error_code: 'azure_unavailable' }],
      }}
    />,
  )
  expect(screen.getByText(/azure_unavailable/)).toBeInTheDocument()
  expect(screen.getByText('Inconclusive')).toBeInTheDocument()
})
