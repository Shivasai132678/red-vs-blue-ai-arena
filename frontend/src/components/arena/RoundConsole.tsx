import type { Stage } from '../../hooks/useMatch'
import { categoryLabels, duration } from '../../lib/format'
import { isAttack, roundResult } from '../../lib/match'
import type { RoundResult } from '../../lib/match'
import type { Evaluation, StatusResponse } from '../../types'
import { LAYER_SHORT } from '../../lib/layers'

type Layer = StatusResponse['checks'][number]

const STATUS_TEXT = { flagged: 'Flagged', passed: 'Passed', error: 'Failed', skipped: 'Skipped' } as const

export function RoundConsole({
  current,
  stage,
  layers,
  onEvidence,
}: {
  current: Evaluation
  stage: Stage
  layers: Layer[]
  onEvidence: (id: string) => void
}) {
  const revealed = stage === 'impact' || stage === 'result'
  const attack = isAttack(current)
  return (
    <div className="console">
      <section className={`console-card ${attack ? 'from-red' : 'from-user'}`}>
        <header>
          <span className="console-kicker">{attack ? 'Red transmission' : 'User request'}</span>
          <h2>{current.scenario.name}</h2>
          <span className="tag">{categoryLabels[current.scenario.category]}</span>
        </header>
        {current.scenario.purpose && <p className="console-purpose">{current.scenario.purpose}</p>}
        <p className="field-label">Prompt</p>
        <pre className="transmission" key={current.id}>
          {current.prompt}
        </pre>
        {current.document && (
          <>
            <p className="field-label">Attached document</p>
            <pre className="transmission transmission-doc">{current.document}</pre>
          </>
        )}
        {current.expected && (
          <p className="expectation-line">
            <span>Expected</span> {current.expected.outcome === 'blocked' ? 'Blocked' : 'Allowed'} ·{' '}
            {current.expected.rationale}
          </p>
        )}
      </section>

      <section className="console-card from-blue" aria-live="polite">
        <header>
          <span className="console-kicker">Blue defense log</span>
          <h2>{revealed ? 'Verdict' : stage === 'scan' ? 'Analyzing…' : 'Incoming'}</h2>
        </header>
        <ol className="defense-log">
          {layers.map((layer, i) => {
            const check = current.checks.find((c) => c.check_id === layer.id)
            const state = !revealed
              ? stage === 'scan'
                ? 'scanning'
                : 'waiting'
              : (check?.status ?? 'skipped')
            return (
              <li key={layer.id} className={`log-line log-${state}`}>
                <span className="log-index">{String(i + 1).padStart(2, '0')}</span>
                <span className="log-name">
                  {LAYER_SHORT[layer.id] ?? layer.name}
                  <span className={`source-pill source-${layer.configured ? layer.source : 'off'}`}>
                    {!layer.configured ? 'Off' : layer.source === 'azure' ? 'Azure' : 'Local'}
                  </span>
                </span>
                <span className="log-status">
                  {state === 'waiting'
                    ? '—'
                    : state === 'scanning'
                      ? 'checking'
                      : STATUS_TEXT[check?.status ?? 'skipped']}
                </span>
                {revealed && check && (
                  <span className="log-reason">
                    {check.reason}
                    {check.duration_ms > 0 && (
                      <span className="log-ms"> · {duration(check.duration_ms)}</span>
                    )}
                  </span>
                )}
              </li>
            )
          })}
        </ol>
        {revealed && (
          <div className="verdict">
            <p className="verdict-action">{current.application_action}</p>
            <button className="btn btn-ghost" onClick={() => onEvidence(current.id)}>
              Full evidence →
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

const PIP_LABEL: Record<RoundResult, string> = {
  blocked: 'blocked',
  got_through: 'got through',
  false_alarm: 'false alarm',
  delivered: 'delivered',
  failed: 'check failed',
}

export function RoundTrack({
  rounds,
  finished,
  round,
  onEvidence,
}: {
  rounds: Evaluation[]
  finished: number
  round: number
  onEvidence: (id: string) => void
}) {
  return (
    <ol className="round-track" aria-label="Rounds">
      {rounds.map((ev, i) => {
        const result = i < finished ? roundResult(ev) : null
        const label = `Round ${i + 1}: ${ev.scenario.name}${result ? `, ${PIP_LABEL[result]}` : ''}`
        return (
          <li key={ev.id}>
            <button
              className={`pip ${result ? `pip-${result}` : ''} ${i === round ? 'pip-current' : ''}`}
              disabled={!result}
              title={label}
              aria-label={label}
              onClick={() => onEvidence(ev.id)}
            >
              {i + 1}
            </button>
          </li>
        )
      })}
    </ol>
  )
}
