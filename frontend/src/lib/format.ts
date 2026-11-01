import type { Category, Evaluation } from '../types'
export const categoryLabels: Record<Category, string> = {
  normal_request: 'Normal request',
  direct_injection: 'Direct injection',
  indirect_injection: 'Indirect injection',
  secret_extraction: 'Secret extraction',
  encoded_instruction: 'Encoded instruction',
  benign_document: 'Harmless document',
  custom: 'Custom',
}
export const time = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
export const duration = (value: number | null) => (value === null ? '—' : `${value.toLocaleString()} ms`)
export const pending = (evaluation: Evaluation) =>
  evaluation.status === 'queued' || evaluation.status === 'checking'
export const message = (error: unknown) =>
  error instanceof Error ? error.message : 'An unexpected error occurred.'
export const newest = (items: Evaluation[]) =>
  [...items].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
