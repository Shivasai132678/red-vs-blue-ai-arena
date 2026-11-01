import { layerName } from '../../lib/layers'
import type { MatchScore } from '../../lib/match'
import type { Evaluation } from '../../types'

// Shown instead of a winner: what this match actually demonstrated.
export function Debrief({
  score,
  rounds,
  onEvidence,
  onRematch,
  onSetup,
}: {
  score: MatchScore
  rounds: Evaluation[]
  onEvidence: (id: string) => void
  onRematch: () => void
  onSetup: () => void
}) {
  const attacks = score.blocked + score.gotThrough
  const traffic = score.falseAlarms + score.delivered
  const rate = score.detectionRate === null ? null : Math.round(score.detectionRate * 100)
  const layers = Object.entries(score.byLayer).sort((a, b) => b[1] - a[1])
  const maxLayer = Math.max(1, ...layers.map(([, n]) => n))

  return (
    <section className="debrief" aria-labelledby="debrief-title">
      <header>
        <span className="kicker">Match debrief</span>
        <h2 id="debrief-title">
          {attacks === 0
            ? 'No attack produced a verdict'
            : `Blue stopped ${score.blocked} of ${attacks} attacks${rate === null ? '' : ` (${rate}%)`}`}
        </h2>
        <p className="muted">
          {rounds.length} live evaluations
          {traffic > 0 && ` · ${score.falseAlarms} of ${traffic} normal requests wrongly blocked`}
          {score.failed > 0 && ` · ${score.failed} check failures (not counted as allowed)`}
        </p>
      </header>

      <div className="debrief-grid">
        <div className="debrief-block">
          <h3>Stopped by layer</h3>
          {layers.length ? (
            <ul className="bars">
              {layers.map(([id, n]) => (
                <li key={id}>
                  <span>{layerName(id, id)}</span>
                  <span className="bar">
                    <span style={{ width: `${(n / maxLayer) * 100}%` }} />
                  </span>
                  <span className="mono">{n}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No attack was blocked.</p>
          )}
        </div>
        <EvidenceList
          title="Missed attacks"
          empty="Every attack with a verdict was blocked."
          items={score.missed}
          tone="red"
          onEvidence={onEvidence}
        />
        <EvidenceList
          title="False alarms"
          empty={traffic ? 'All normal requests passed.' : 'No normal traffic in this match.'}
          items={score.falseAlarmList}
          tone="amber"
          onEvidence={onEvidence}
        />
      </div>

      <p className="fine-print">
        These figures describe this scenario set against this Azure resource at this time. They are not a
        general detection rate. Allowed means no layer flagged the input; no model was called.
      </p>
      <div className="debrief-actions">
        <button className="btn btn-primary" onClick={onRematch}>
          Rematch
        </button>
        <button className="btn btn-ghost" onClick={onSetup}>
          Change rounds
        </button>
        <a className="btn btn-ghost" href="#/log">
          Open evidence log
        </a>
      </div>
    </section>
  )
}

function EvidenceList({
  title,
  empty,
  items,
  tone,
  onEvidence,
}: {
  title: string
  empty: string
  items: Evaluation[]
  tone: 'red' | 'amber'
  onEvidence: (id: string) => void
}) {
  return (
    <div className={`debrief-block tone-${tone}`}>
      <h3>
        {title} <span className="mono">{items.length}</span>
      </h3>
      {items.length ? (
        <ul className="evidence-links">
          {items.map((ev) => (
            <li key={ev.id}>
              <button className="link" onClick={() => onEvidence(ev.id)}>
                {ev.scenario.name}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{empty}</p>
      )}
    </div>
  )
}
