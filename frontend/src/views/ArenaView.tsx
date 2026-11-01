import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { CustomAttackDialog } from '../components/arena/CustomAttackDialog'
import { Debrief } from '../components/arena/Debrief'
import { RoundConsole, RoundTrack } from '../components/arena/RoundConsole'
import { Setup } from '../components/arena/Setup'
import { Stage } from '../components/arena/Stage'
import { EvidenceDrawer } from '../components/EvidenceDrawer'
import { useMatch } from '../hooks/useMatch'
import type { Speed } from '../hooks/useMatch'
import { useResource } from '../hooks/useResource'
import type { StatusResponse } from '../types'

export function ArenaView({
  status,
  statusError,
  verifying,
  onVerify,
}: {
  status: StatusResponse | null
  statusError: string | null
  verifying: boolean
  onVerify: () => void
}) {
  const library = useResource(useCallback(() => api.scenarios(), []))
  const match = useMatch()
  const [customOpen, setCustomOpen] = useState(false)
  const [evidenceId, setEvidenceId] = useState<string | null>(null)
  const layers = status?.checks ?? []
  const running = match.phase === 'running'

  // The setup panel disappears when a match starts; bring the stage back into view.
  useEffect(() => {
    if (running) window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [running])

  const openEvidence = (id: string) => {
    setEvidenceId(id)
    if (running && !match.paused) match.togglePause()
  }
  const closeEvidence = useCallback(() => setEvidenceId(null), [])

  return (
    <div className="arena">
      <Stage
        phase={match.phase}
        stage={match.stage}
        round={match.round}
        totalRounds={match.totalRounds}
        current={match.current}
        score={match.score}
        layers={layers}
        speed={match.speed}
      />

      {(running || match.phase === 'debrief') && (
        <div className="scorebar">
          <Score label="Blocked" value={match.score.blocked} tone="blue" />
          <Score label="Got through" value={match.score.gotThrough} tone="red" />
          <Score label="False alarms" value={match.score.falseAlarms} tone="amber" />
          <Score label="Check failed" value={match.score.failed} tone="amber" />
          {running && (
            <div className="controls">
              {match.connectionLost && <span className="notice-inline">Connection lost · retrying</span>}
              <div className="segmented segmented-small" role="group" aria-label="Playback speed">
                {([1, 2, 4] as Speed[]).map((s) => (
                  <button key={s} className={match.speed === s ? 'on' : ''} onClick={() => match.setSpeed(s)}>
                    {s}×
                  </button>
                ))}
              </div>
              <button className="btn btn-ghost btn-small" onClick={match.togglePause}>
                {match.paused ? 'Resume' : 'Pause'}
              </button>
            </div>
          )}
        </div>
      )}

      {(running || match.phase === 'debrief') && (
        <RoundTrack
          rounds={match.rounds}
          finished={match.finished.length}
          round={running ? match.round : -1}
          onEvidence={openEvidence}
        />
      )}

      {(match.phase === 'setup' || match.phase === 'starting') && (
        <Setup
          status={status}
          statusError={statusError}
          verifying={verifying}
          onVerify={onVerify}
          library={library.data}
          libraryError={library.error}
          starting={match.phase === 'starting'}
          error={match.error}
          onStart={(scenarios) => void match.start(scenarios)}
          onCustom={() => setCustomOpen(true)}
        />
      )}

      {running && match.current && (
        <RoundConsole current={match.current} stage={match.stage} layers={layers} onEvidence={openEvidence} />
      )}

      {match.phase === 'debrief' && (
        <Debrief
          score={match.score}
          rounds={match.rounds}
          onEvidence={openEvidence}
          onRematch={match.rematch}
          onSetup={match.reset}
        />
      )}

      <CustomAttackDialog
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        onSubmit={match.startCustom}
      />
      {evidenceId && <EvidenceDrawer evaluationId={evidenceId} onClose={closeEvidence} />}
    </div>
  )
}

function Score({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`score tone-${tone}`}>
      <span className="score-value">{value}</span>
      <span className="score-label">{label}</span>
    </div>
  )
}
