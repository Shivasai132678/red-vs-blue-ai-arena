import { describe, expect, it } from 'vitest'
import { evaluation } from '../test/fixtures'
import type { Evaluation, Outcome } from '../types'
import { isAttack, roundResult, scoreMatch, stoppingLayer } from './match'

function make(id: string, expected: 'blocked' | 'allowed' | null, outcome: Outcome | null): Evaluation {
  return {
    ...evaluation,
    id,
    expected: expected ? { outcome: expected, rationale: 'r' } : null,
    outcome,
    status: outcome === null ? 'checking' : outcome === 'check_failed' ? 'check_failed' : 'completed',
  }
}

describe('isAttack', () => {
  it('treats inputs expected to be allowed as normal traffic', () => {
    expect(isAttack(make('a', 'allowed', null))).toBe(false)
    expect(isAttack(make('b', 'blocked', null))).toBe(true)
  })
  it('treats custom prompts without an expectation as attacks', () => {
    expect(isAttack(make('c', null, null))).toBe(true)
  })
})

describe('roundResult', () => {
  it('maps attack outcomes', () => {
    expect(roundResult(make('a', 'blocked', 'blocked'))).toBe('blocked')
    expect(roundResult(make('a', 'blocked', 'allowed'))).toBe('got_through')
    expect(roundResult(make('a', 'blocked', 'check_failed'))).toBe('failed')
  })
  it('maps normal traffic outcomes', () => {
    expect(roundResult(make('a', 'allowed', 'blocked'))).toBe('false_alarm')
    expect(roundResult(make('a', 'allowed', 'allowed'))).toBe('delivered')
    expect(roundResult(make('a', 'allowed', 'check_failed'))).toBe('failed')
  })
  it('returns null while checks are running', () => {
    expect(roundResult(make('a', 'blocked', null))).toBeNull()
  })
})

describe('stoppingLayer', () => {
  it('returns the earliest flagged check in pipeline order', () => {
    const ev: Evaluation = {
      ...evaluation,
      checks: [
        { ...evaluation.checks[1]!, check_id: 'late', order: 4, status: 'flagged' },
        { ...evaluation.checks[1]!, check_id: 'early', order: 1, status: 'flagged' },
      ],
    }
    expect(stoppingLayer(ev)?.check_id).toBe('early')
  })
  it('returns null when nothing flagged', () => {
    const ev: Evaluation = { ...evaluation, checks: [{ ...evaluation.checks[0]!, status: 'passed' }] }
    expect(stoppingLayer(ev)).toBeNull()
  })
})

describe('scoreMatch', () => {
  it('starts both bars full', () => {
    const s = scoreMatch([], 4)
    expect(s.blueHp).toBe(100)
    expect(s.redHp).toBe(100)
  })

  it('drains bars by 1/N of planned attacks; failures and traffic do not move them', () => {
    const rounds = [
      make('1', 'blocked', 'blocked'),
      make('2', 'blocked', 'blocked'),
      make('3', 'blocked', 'allowed'),
      make('4', 'blocked', 'check_failed'),
      make('5', 'allowed', 'blocked'),
      make('6', 'allowed', 'allowed'),
    ]
    const s = scoreMatch(rounds, 4)
    expect(s.blocked).toBe(2)
    expect(s.gotThrough).toBe(1)
    expect(s.failed).toBe(1)
    expect(s.falseAlarms).toBe(1)
    expect(s.delivered).toBe(1)
    expect(s.redHp).toBe(50)
    expect(s.blueHp).toBe(75)
    expect(s.missed.map((e) => e.id)).toEqual(['3'])
    expect(s.falseAlarmList.map((e) => e.id)).toEqual(['5'])
  })

  it('counts which layer stopped each blocked attack', () => {
    const s = scoreMatch([make('1', 'blocked', 'blocked')], 1)
    expect(s.byLayer).toEqual({ shields: 1 })
  })

  it('ignores rounds that are still running', () => {
    const s = scoreMatch([make('1', 'blocked', null)], 1)
    expect(s.blocked + s.gotThrough + s.failed).toBe(0)
  })

  it('reports detection rate only over attacks with a verdict', () => {
    const s = scoreMatch([make('1', 'blocked', 'blocked'), make('2', 'blocked', 'check_failed')], 2)
    expect(s.detectionRate).toBe(1)
    expect(scoreMatch([], 2).detectionRate).toBeNull()
  })
})
