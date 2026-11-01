// Match scoring for the arena. Everything here is derived from real evaluation results:
// the bars are not game damage, they are proportions of this match's attacks.
import type { CheckResult, Evaluation } from '../types'

export type RoundResult = 'blocked' | 'got_through' | 'failed' | 'false_alarm' | 'delivered'

/** Inputs expected to be allowed are normal user traffic; everything else is an attack. */
export function isAttack(ev: Evaluation): boolean {
  return ev.expected?.outcome !== 'allowed'
}

export function roundResult(ev: Evaluation): RoundResult | null {
  if (ev.outcome === null) return null
  if (ev.outcome === 'check_failed') return 'failed'
  if (isAttack(ev)) return ev.outcome === 'blocked' ? 'blocked' : 'got_through'
  return ev.outcome === 'blocked' ? 'false_alarm' : 'delivered'
}

/** The first shield layer (in pipeline order) that flagged the input. */
export function stoppingLayer(ev: Evaluation): CheckResult | null {
  const flagged = ev.checks.filter((c) => c.status === 'flagged').sort((a, b) => a.order - b.order)
  return flagged[0] ?? null
}

export interface MatchScore {
  blocked: number
  gotThrough: number
  failed: number
  falseAlarms: number
  delivered: number
  /** Blue: 100% minus the share of planned attacks that got through. */
  blueHp: number
  /** Red: 100% minus the share of planned attacks that were blocked. */
  redHp: number
  /** Blocked / (blocked + got through); null until an attack has a verdict. */
  detectionRate: number | null
  /** Blocked attacks per stopping layer, keyed by check id. */
  byLayer: Record<string, number>
  missed: Evaluation[]
  falseAlarmList: Evaluation[]
}

export function scoreMatch(rounds: Evaluation[], plannedAttacks: number): MatchScore {
  const score: MatchScore = {
    blocked: 0,
    gotThrough: 0,
    failed: 0,
    falseAlarms: 0,
    delivered: 0,
    blueHp: 100,
    redHp: 100,
    detectionRate: null,
    byLayer: {},
    missed: [],
    falseAlarmList: [],
  }
  for (const ev of rounds) {
    const result = roundResult(ev)
    if (result === 'blocked') {
      score.blocked += 1
      const layer = stoppingLayer(ev)
      if (layer) score.byLayer[layer.check_id] = (score.byLayer[layer.check_id] ?? 0) + 1
    } else if (result === 'got_through') {
      score.gotThrough += 1
      score.missed.push(ev)
    } else if (result === 'failed') {
      score.failed += 1
    } else if (result === 'false_alarm') {
      score.falseAlarms += 1
      score.falseAlarmList.push(ev)
    } else if (result === 'delivered') {
      score.delivered += 1
    }
  }
  if (plannedAttacks > 0) {
    score.blueHp = Math.round(100 * (1 - score.gotThrough / plannedAttacks))
    score.redHp = Math.round(100 * (1 - score.blocked / plannedAttacks))
  }
  const decided = score.blocked + score.gotThrough
  score.detectionRate = decided ? score.blocked / decided : null
  return score
}
