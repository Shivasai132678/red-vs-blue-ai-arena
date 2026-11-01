import type { CSSProperties } from 'react'
import type { Phase, Speed, Stage as StageName } from '../../hooks/useMatch'
import { isAttack, roundResult, stoppingLayer } from '../../lib/match'
import type { MatchScore, RoundResult } from '../../lib/match'
import type { CheckResult, Evaluation, StatusResponse } from '../../types'
import { categoryLabels } from '../../lib/format'
import { LAYER_SHORT, layerName } from '../../lib/layers'

type Layer = StatusResponse['checks'][number]

// Horizontal positions (percent of stage width).
const RED_HAND_X = 31
const SHIELD_FRONT_X = 52
const LAYER_X = [56, 60, 64, 68]
const BLUE_BODY_X = 80

const STAMP: Record<RoundResult, { title: string; tone: string }> = {
  blocked: { title: 'Blocked', tone: 'blue' },
  got_through: { title: 'Got through', tone: 'red' },
  false_alarm: { title: 'False alarm', tone: 'amber' },
  delivered: { title: 'Delivered', tone: 'green' },
  failed: { title: 'Check failed', tone: 'amber' },
}

function stampDetail(result: RoundResult, stop: CheckResult | null): string {
  const by = stop
    ? `${layerName(stop.check_id, stop.name)} · ${stop.source === 'azure' ? 'Azure' : 'local rule'}`
    : ''
  switch (result) {
    case 'blocked':
      return `Stopped by ${by}`
    case 'got_through':
      return 'No layer flagged this attack'
    case 'false_alarm':
      return `Normal request flagged by ${by}`
    case 'delivered':
      return 'Normal request passed every layer'
    case 'failed':
      return 'A required check did not complete · request withheld'
  }
}

function layerState(layer: Layer, ev: Evaluation | null, stage: StageName): string {
  if (!layer.configured) return 'off'
  if (!ev || stage === 'charge' || stage === 'travel') return 'idle'
  if (stage === 'scan') return 'scanning'
  const check = ev.checks.find((c) => c.check_id === layer.id)
  if (!check) return 'idle'
  return { flagged: 'hit', passed: 'pass', error: 'offline', skipped: 'off' }[check.status]
}

export function Stage({
  phase,
  stage,
  round,
  totalRounds,
  current,
  score,
  layers,
  speed,
}: {
  speed: Speed
  phase: Phase
  stage: StageName
  round: number
  totalRounds: number
  current: Evaluation | null
  score: MatchScore
  layers: Layer[]
}) {
  const live = phase === 'running' && current !== null
  const attack = current ? isAttack(current) : true
  const revealed = live && (stage === 'impact' || stage === 'result')
  const result = revealed && current ? roundResult(current) : null
  const stop = current ? stoppingLayer(current) : null
  const stopIndex = stop ? layers.findIndex((l) => l.id === stop.check_id) : -1

  let orbX = RED_HAND_X
  if (stage === 'travel' || stage === 'scan') orbX = SHIELD_FRONT_X
  if (result === 'blocked' || result === 'false_alarm') orbX = (LAYER_X[stopIndex] ?? SHIELD_FRONT_X) - 1.5
  if (result === 'got_through' || result === 'delivered') orbX = BLUE_BODY_X
  if (result === 'failed') orbX = SHIELD_FRONT_X

  const classes = [
    'stage',
    `phase-${phase}`,
    live ? `stage-${stage}` : '',
    result ? `result-${result}` : '',
    attack ? 'is-attack' : 'is-traffic',
  ].join(' ')

  return (
    <section className={classes} aria-label="Arena" style={{ '--spd': speed } as CSSProperties}>
      <div className="stage-floor" aria-hidden="true" />

      <header className="hud">
        <Meter side="red" label="Red · attacker" caption="Attack strength" value={score.redHp} />
        <div className="hud-center">
          {live ? (
            <>
              <span className="hud-round">
                Round {String(round + 1).padStart(2, '0')}
                <span className="hud-of"> / {String(totalRounds).padStart(2, '0')}</span>
              </span>
              <span className="hud-category">
                {attack ? categoryLabels[current.scenario.category] : 'Normal user traffic'}
              </span>
            </>
          ) : (
            <span className="hud-vs">VS</span>
          )}
        </div>
        <Meter side="blue" label="Blue · defender" caption="Shield integrity" value={score.blueHp} />
      </header>

      <figure className="fighter fighter-red" aria-hidden="true">
        <img src="/assets/red-mech.jpg" alt="" />
      </figure>
      <figure className="fighter fighter-blue" aria-hidden="true">
        <img src="/assets/blue-mech.jpg" alt="" />
      </figure>

      <div className="shields" aria-label="Defense layers in pipeline order">
        {layers.map((layer, i) => (
          <div
            key={layer.id}
            className={`shield shield-${layerState(layer, live ? current : null, stage)}`}
            style={{ left: `${LAYER_X[i] ?? 68}%` } as CSSProperties}
          >
            <span className="shield-plate" />
            <span className="shield-label">
              <span className="shield-index">{String(i + 1).padStart(2, '0')}</span>
              {LAYER_SHORT[layer.id] ?? layer.name}
              <span className={`shield-source source-${layer.source}`}>
                {layer.configured ? (layer.source === 'azure' ? 'Azure' : 'Local') : 'Off'}
              </span>
            </span>
          </div>
        ))}
      </div>

      {live && (
        <div
          key={current.id}
          className="orb"
          style={{ left: `${orbX}%` } as CSSProperties}
          aria-hidden="true"
        >
          <span className="orb-core" />
          <span className="orb-tag">{attack ? 'payload' : 'request'}</span>
        </div>
      )}

      {result && current && (
        <div className={`stamp tone-${STAMP[result].tone}`} role="status">
          <strong>{STAMP[result].title}</strong>
          <span>{stampDetail(result, stop)}</span>
        </div>
      )}

      {!live && phase !== 'debrief' && (
        <div className="stage-idle">
          <span>{phase === 'starting' ? 'Submitting to Azure…' : 'Awaiting match'}</span>
        </div>
      )}
    </section>
  )
}

function Meter({
  side,
  label,
  caption,
  value,
}: {
  side: 'red' | 'blue'
  label: string
  caption: string
  value: number
}) {
  return (
    <div className={`meter meter-${side}`}>
      <div className="meter-top">
        <span className="meter-label">{label}</span>
        <span className="meter-value">{value}%</span>
      </div>
      <div
        className="meter-track"
        role="meter"
        aria-label={`${label} ${caption}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
      >
        <span className="meter-fill" style={{ width: `${value}%` }} />
      </div>
      <span className="meter-caption">{caption}</span>
    </div>
  )
}
