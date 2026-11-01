// Drives a match: submits real evaluations, polls the server for results, and steps
// the arena animation round by round. The "scan" stage holds until the server has an
// actual verdict, so the animation never shows a result before Azure returned one.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { message, pending } from '../lib/format'
import { isAttack, scoreMatch } from '../lib/match'
import type { MatchScore } from '../lib/match'
import type { CreateEvaluation, Evaluation, Scenario } from '../types'

export type Phase = 'setup' | 'starting' | 'running' | 'debrief'
export type Stage = 'charge' | 'travel' | 'scan' | 'impact' | 'result'
export type Speed = 1 | 2 | 4

const STAGE_MS: Record<Exclude<Stage, 'scan'>, number> = {
  charge: 700,
  travel: 900,
  impact: 850,
  result: 2000,
}
const MIN_SCAN_MS = 600
const POLL_MS = 600

type Plan = { kind: 'scenarios'; scenarios: Scenario[] } | { kind: 'custom'; request: CreateEvaluation }

export interface Match {
  phase: Phase
  stage: Stage
  round: number
  totalRounds: number
  current: Evaluation | null
  rounds: Evaluation[]
  finished: Evaluation[]
  score: MatchScore
  speed: Speed
  paused: boolean
  error: string | null
  connectionLost: boolean
  start: (scenarios: Scenario[]) => Promise<void>
  startCustom: (request: CreateEvaluation) => Promise<void>
  rematch: () => void
  reset: () => void
  setSpeed: (speed: Speed) => void
  togglePause: () => void
}

export function useMatch(): Match {
  const [phase, setPhase] = useState<Phase>('setup')
  const [stage, setStage] = useState<Stage>('charge')
  const [ids, setIds] = useState<string[]>([])
  const [batchId, setBatchId] = useState<string | null>(null)
  const [evals, setEvals] = useState<Record<string, Evaluation>>({})
  const [round, setRound] = useState(0)
  const [finishedCount, setFinishedCount] = useState(0)
  const [plannedAttacks, setPlannedAttacks] = useState(0)
  const [speed, setSpeed] = useState<Speed>(1)
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectionLost, setConnectionLost] = useState(false)
  const plan = useRef<Plan | null>(null)
  const scanStarted = useRef(0)

  const rounds = useMemo(() => ids.flatMap((id) => (evals[id] ? [evals[id]] : [])), [ids, evals])
  const finished = useMemo(() => rounds.slice(0, finishedCount), [rounds, finishedCount])
  const score = useMemo(() => scoreMatch(finished, plannedAttacks), [finished, plannedAttacks])
  const current = rounds[round] ?? null

  const begin = useCallback((list: Evaluation[], batch: string | null, attacks: number) => {
    setEvals(Object.fromEntries(list.map((e) => [e.id, e])))
    setIds(list.map((e) => e.id))
    setBatchId(batch)
    setPlannedAttacks(attacks)
    setRound(0)
    setFinishedCount(0)
    setStage('charge')
    setPaused(false)
    setConnectionLost(false)
    setPhase('running')
  }, [])

  const start = useCallback(
    async (scenarios: Scenario[]) => {
      plan.current = { kind: 'scenarios', scenarios }
      setError(null)
      setPhase('starting')
      try {
        const res = await api.batch(scenarios.map((s) => s.id))
        begin(
          res.evaluations,
          res.batch_id,
          scenarios.filter((s) => s.expected?.outcome !== 'allowed').length,
        )
      } catch (err) {
        setError(message(err))
        setPhase('setup')
      }
    },
    [begin],
  )

  const startCustom = useCallback(
    async (request: CreateEvaluation) => {
      plan.current = { kind: 'custom', request }
      setError(null)
      setPhase('starting')
      try {
        const ev = await api.create(request)
        begin([ev], null, isAttack(ev) ? 1 : 0)
      } catch (err) {
        setError(message(err))
        setPhase('setup')
        throw err
      }
    },
    [begin],
  )

  const rematch = useCallback(() => {
    const p = plan.current
    if (!p) return
    if (p.kind === 'scenarios') void start(p.scenarios)
    else void startCustom(p.request).catch(() => undefined)
  }, [start, startCustom])

  const reset = useCallback(() => {
    setPhase('setup')
    setIds([])
    setEvals({})
    setError(null)
  }, [])

  // Poll the server until every evaluation in the match has a verdict.
  const anyPending = rounds.some(pending)
  useEffect(() => {
    if (phase !== 'running' || !anyPending) return
    let active = true
    const timer = setTimeout(async () => {
      try {
        const fresh = batchId
          ? (await api.list({ batch_id: batchId })).evaluations
          : await Promise.all(rounds.filter(pending).map((e) => api.evaluation(e.id)))
        if (!active) return
        setConnectionLost(false)
        setEvals((prev) => ({ ...prev, ...Object.fromEntries(fresh.map((e) => [e.id, e])) }))
      } catch {
        if (active) setConnectionLost(true)
        // Force another poll cycle by touching state; the effect re-runs on evals change.
        if (active) setEvals((prev) => ({ ...prev }))
      }
    }, POLL_MS)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [phase, anyPending, batchId, rounds])

  // Step the animation for the current round.
  const currentDone = current !== null && !pending(current)
  useEffect(() => {
    if (phase !== 'running' || paused || !current) return
    let delay: number
    let next: () => void
    if (stage === 'scan') {
      if (!currentDone) return // wait for the real verdict
      delay = Math.max(0, MIN_SCAN_MS - (performance.now() - scanStarted.current)) / speed
      // The score includes a round only once its impact is shown.
      next = () => {
        setFinishedCount((n) => Math.max(n, round + 1))
        setStage('impact')
      }
    } else if (stage === 'impact') {
      delay = STAGE_MS.impact / speed
      next = () => setStage('result')
    } else if (stage === 'result') {
      delay = STAGE_MS.result / speed
      next = () => {
        if (round + 1 >= ids.length) {
          setPhase('debrief')
        } else {
          setRound(round + 1)
          setStage('charge')
        }
      }
    } else {
      delay = STAGE_MS[stage] / speed
      next = () => {
        if (stage === 'travel') scanStarted.current = performance.now()
        setStage(stage === 'charge' ? 'travel' : 'scan')
      }
    }
    const timer = setTimeout(next, delay)
    return () => clearTimeout(timer)
  }, [phase, paused, current, currentDone, stage, speed, round, ids.length])

  return {
    phase,
    stage,
    round,
    totalRounds: ids.length,
    current,
    rounds,
    finished,
    score,
    speed,
    paused,
    error,
    connectionLost,
    start,
    startCustom,
    rematch,
    reset,
    setSpeed,
    togglePause: () => setPaused((p) => !p),
  }
}
