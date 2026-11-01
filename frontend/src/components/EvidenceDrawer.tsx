import { useCallback, useEffect, useRef } from 'react'
import { api } from '../api'
import { useResource } from '../hooks/useResource'
import { pending } from '../lib/format'
import { EvaluationDetail } from '../views/EvaluationDetail'
import { ErrorState, Loading } from './Common'

/** Slide-over panel with the full evidence for one evaluation. Esc or backdrop closes it. */
export function EvidenceDrawer({ evaluationId, onClose }: { evaluationId: string; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null)
  const detail = useResource(
    useCallback(() => api.evaluation(evaluationId), [evaluationId]),
    (data) => (pending(data) ? 750 : false),
  )

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [evaluationId, onClose])

  return (
    <>
      <div className="drawer-backdrop" aria-hidden="true" onClick={onClose} />
      <aside
        ref={panel}
        className="drawer"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Evaluation evidence"
      >
        {detail.loading ? (
          <Loading />
        ) : detail.error ? (
          <>
            <ErrorState error={detail.error} retry={detail.reload} />
            <button className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </>
        ) : (
          detail.data && <EvaluationDetail evaluation={detail.data} onClose={onClose} />
        )}
      </aside>
    </>
  )
}
