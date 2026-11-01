import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { Badge } from '../components/Badge'
import { EmptyState, ErrorState, Loading } from '../components/Common'
import { EvidenceDrawer } from '../components/EvidenceDrawer'
import { useResource } from '../hooks/useResource'
import { categoryLabels, duration, message, newest, pending, time } from '../lib/format'

const open = (id: string) => {
  window.location.hash = `/log/${encodeURIComponent(id)}`
}

export function HistoryView({ evaluationId }: { evaluationId?: string }) {
  const [category, setCategory] = useState('')
  const [outcome, setOutcome] = useState('')
  const [source, setSource] = useState('')
  const list = useResource(
    useCallback(() => api.list({ category, outcome, source }), [category, outcome, source]),
    (data) => (data.evaluations.some(pending) ? 2000 : false),
  )
  const [confirm, setConfirm] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const closeDetail = useCallback(() => {
    window.location.hash = '/log'
  }, [])

  useEffect(() => {
    if (confirm) dialog.current?.showModal()
    else dialog.current?.close()
  }, [confirm])

  async function clear() {
    setClearing(true)
    setClearError(null)
    try {
      await api.clear()
      setConfirm(false)
      closeDetail()
      list.reload()
    } catch (err) {
      setClearError(message(err))
    } finally {
      setClearing(false)
    }
  }

  const filtered = Boolean(category || outcome || source)
  return (
    <div className="log">
      <div className="page-head">
        <div>
          <span className="kicker">Evidence log</span>
          <h1>Every round, every check</h1>
          <p className="muted">Each row is a stored evaluation. Open one to see the raw Azure responses.</p>
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => {
            setClearError(null)
            setConfirm(true)
          }}
        >
          Clear history
        </button>
      </div>

      <div className="filter-bar">
        <label>
          <span className="field-label">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {Object.entries(categoryLabels).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Result</span>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">All results</option>
            <option value="blocked">Blocked</option>
            <option value="allowed">Allowed</option>
            <option value="check_failed">Check failed</option>
          </select>
        </label>
        <label>
          <span className="field-label">Detected by</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Any source</option>
            <option value="azure">Azure</option>
            <option value="local">Local rule</option>
          </select>
        </label>
        <button
          className="btn btn-ghost btn-small"
          disabled={!filtered}
          onClick={() => {
            setCategory('')
            setOutcome('')
            setSource('')
          }}
        >
          Clear filters
        </button>
        <span className="filter-count mono">
          {list.data ? `${list.data.evaluations.length} results` : ''}
        </span>
      </div>

      <section className="card table-card" aria-label="Evaluation list">
        {list.error ? (
          <ErrorState error={list.error} retry={list.reload} />
        ) : list.loading ? (
          <Loading />
        ) : !list.data?.evaluations.length ? (
          <EmptyState title={filtered ? 'No evaluations match' : 'No evaluations yet'}>
            <p>
              {filtered
                ? 'Adjust or clear the filters.'
                : 'Run a match in the arena to start collecting evidence.'}
            </p>
            {!filtered && (
              <a className="btn btn-primary" href="#/arena">
                Go to the arena
              </a>
            )}
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="log-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Scenario</th>
                  <th>Category</th>
                  <th>Result</th>
                  <th>Detected by</th>
                  <th>Expected vs observed</th>
                  <th className="num">Duration</th>
                </tr>
              </thead>
              <tbody>
                {newest(list.data.evaluations).map((e) => (
                  <tr
                    key={e.id}
                    className={e.id === evaluationId ? 'selected' : ''}
                    tabIndex={0}
                    aria-label={`Open ${e.scenario.name}`}
                    onClick={() => open(e.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        open(e.id)
                      }
                    }}
                  >
                    <td className="nowrap mono small">{time(e.created_at)}</td>
                    <td className="strong">{e.scenario.name}</td>
                    <td className="muted">{categoryLabels[e.scenario.category]}</td>
                    <td>
                      <Badge value={e.outcome ?? e.status} />
                    </td>
                    <td>
                      {e.detected_by
                        .map((id) => e.checks.find((check) => check.check_id === id)?.name ?? id)
                        .join(', ') || <span className="muted">—</span>}
                    </td>
                    <td>
                      {e.comparison ? (
                        <Badge value={e.comparison.result} />
                      ) : (
                        <span className="muted">Pending</span>
                      )}
                    </td>
                    <td className="nowrap mono small num">{duration(e.duration_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {evaluationId && <EvidenceDrawer evaluationId={evaluationId} onClose={closeDetail} />}

      <dialog
        ref={dialog}
        className="dialog"
        onCancel={() => setConfirm(false)}
        aria-labelledby="clear-title"
      >
        <h2 id="clear-title">Clear evaluation history?</h2>
        <p className="muted">This deletes every stored evaluation, including inputs and check evidence.</p>
        {clearError && <ErrorState error={clearError} />}
        <div className="dialog-actions">
          <button className="btn btn-ghost" disabled={clearing} onClick={() => setConfirm(false)}>
            Cancel
          </button>
          <button className="btn btn-danger" disabled={clearing} onClick={() => void clear()}>
            {clearing ? 'Clearing…' : 'Delete all evaluations'}
          </button>
        </div>
      </dialog>
    </div>
  )
}
