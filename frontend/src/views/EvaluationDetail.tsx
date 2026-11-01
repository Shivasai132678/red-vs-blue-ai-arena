import { Badge } from '../components/Badge'
import { CodeBlock } from '../components/Common'
import { categoryLabels, duration, pending, time } from '../lib/format'
import type { Evaluation } from '../types'

export function EvaluationDetail({
  evaluation: e,
  onClose,
}: {
  evaluation: Evaluation
  onClose?: () => void
}) {
  const checks = [...e.checks].sort((a, b) => a.order - b.order)
  return (
    <article className="detail" aria-label="Evaluation evidence">
      <header className="detail-head">
        <div className="detail-head-row">
          <span className="kicker">Evaluation evidence</span>
          {onClose && (
            <button
              className="btn btn-ghost btn-small"
              onClick={onClose}
              aria-label="Close evaluation detail"
            >
              Close ✕
            </button>
          )}
        </div>
        <h2>{e.scenario.name}</h2>
        <div className="detail-meta">
          <Badge value={e.outcome ?? e.status} />
          <span>{categoryLabels[e.scenario.category]}</span>
          <span className="mono">{time(e.created_at)}</span>
          <span className="mono">{duration(e.duration_ms)}</span>
        </div>
        <dl className="id-list mono">
          <div>
            <dt>Evaluation</dt>
            <dd>{e.id}</dd>
          </div>
          {e.batch_id && (
            <div>
              <dt>Batch</dt>
              <dd>{e.batch_id}</dd>
            </div>
          )}
        </dl>
      </header>

      <section className="detail-section">
        <h3>
          <span>01</span> Input
        </h3>
        <p className="field-label">User prompt</p>
        <CodeBlock>{e.prompt}</CodeBlock>
        <p className="field-label">Attached document</p>
        {e.document ? <CodeBlock>{e.document}</CodeBlock> : <p className="muted">No document</p>}
      </section>

      <section className="detail-section">
        <h3>
          <span>02</span> Expected vs observed
        </h3>
        <div className="compare">
          <div>
            <p className="field-label">Expected (policy)</p>
            {e.expected ? (
              <>
                <Badge value={e.expected.outcome} />
                <p>{e.expected.rationale}</p>
              </>
            ) : (
              <p className="muted">No expected behavior defined.</p>
            )}
          </div>
          <div>
            <p className="field-label">Observed</p>
            {e.outcome ? <Badge value={e.outcome} /> : <p className="muted">Checks running…</p>}
            <p>
              <Badge value={e.comparison?.result ?? 'not_defined'} />{' '}
              {e.comparison?.note ?? (pending(e) ? 'Available when checks complete.' : '')}
            </p>
          </div>
        </div>
      </section>

      <section className="detail-section">
        <h3>
          <span>03</span> Checks performed, in order
        </h3>
        {!checks.length && (
          <p className="muted">
            {pending(e) ? 'Checks are in progress.' : 'No check results were returned.'}
          </p>
        )}
        <ol className="check-list">
          {checks.map((check) => (
            <li key={check.check_id} className={`check check-${check.status}`}>
              <div className="check-head">
                <span className="check-order mono">{String(check.order).padStart(2, '0')}</span>
                <strong>{check.name}</strong>
                <Badge value={check.source} />
                <Badge value={check.status} />
                <span className="mono small muted check-ms">{duration(check.duration_ms)}</span>
              </div>
              <p className="mono small muted">
                {check.service} · {check.required ? 'Required' : 'Optional'}
              </p>
              <p>{check.reason}</p>
              {check.error_code && <p className="error-code mono">error_code: {check.error_code}</p>}
              <details>
                <summary>Service response</summary>
                <CodeBlock>{JSON.stringify(check.details, null, 2)}</CodeBlock>
              </details>
            </li>
          ))}
        </ol>
      </section>

      <section className="detail-section">
        <h3>
          <span>04</span> Decision
        </h3>
        {e.outcome ? (
          <>
            <p>
              <Badge value={e.outcome} /> {e.decision_reason}
            </p>
            <p className="field-label">Application action</p>
            <p className="application-action">{e.application_action ?? 'No application action provided.'}</p>
            {e.outcome === 'allowed' && (
              <p className="fine-print">
                Allowed means no check flagged this input. No language model is connected, so no model
                response exists to evaluate.
              </p>
            )}
          </>
        ) : (
          <p className="muted">Awaiting completed checks.</p>
        )}
      </section>
    </article>
  )
}
