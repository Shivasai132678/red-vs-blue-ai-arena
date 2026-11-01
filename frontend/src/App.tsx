import { useCallback, useState } from 'react'
import { api } from './api'
import { useHashRoute } from './hooks/useHashRoute'
import { useResource } from './hooks/useResource'
import { message } from './lib/format'
import type { StatusResponse } from './types'
import { ArenaView } from './views/ArenaView'
import { HistoryView } from './views/HistoryView'

function App() {
  const route = useHashRoute()
  const status = useResource(useCallback(() => api.status(), []))
  const [verified, setVerified] = useState<StatusResponse | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const current = verified ?? status.data

  const verify = async () => {
    setVerifying(true)
    setVerifyError(null)
    try {
      setVerified(await api.verify())
    } catch (err) {
      setVerifyError(message(err))
    } finally {
      setVerifying(false)
    }
  }

  const state = current?.azure.verification.state
  const chip = !current
    ? status.error
      ? { tone: 'bad', text: 'Server offline' }
      : { tone: 'muted', text: 'Connecting…' }
    : !current.azure.configured
      ? { tone: 'bad', text: 'Azure not configured' }
      : state === 'verified'
        ? { tone: 'ok', text: 'Azure linked · verified' }
        : state === 'failed'
          ? { tone: 'bad', text: 'Azure link failed' }
          : { tone: 'muted', text: 'Azure configured · untested' }

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/arena">
          <span className="brand-red">Red</span>
          <span className="brand-vs">vs</span>
          <span className="brand-blue">Blue</span>
          <span className="brand-sub">Prompt-injection arena · Azure AI Content Safety</span>
        </a>
        <nav aria-label="Main">
          <a href="#/arena" aria-current={route.view === 'arena' ? 'page' : undefined}>
            Arena
          </a>
          <a href="#/log" aria-current={route.view === 'log' ? 'page' : undefined}>
            Evidence log
          </a>
        </nav>
        <span className={`link-chip chip-${chip.tone}`} title={verifyError ?? undefined}>
          <span className="dot" />
          {chip.text}
        </span>
      </header>
      <main id="main">
        {route.view === 'arena' && (
          <ArenaView
            status={current}
            statusError={status.error ?? verifyError}
            verifying={verifying}
            onVerify={() => void verify()}
          />
        )}
        {route.view === 'log' && <HistoryView evaluationId={route.evaluationId} />}
      </main>
    </div>
  )
}

export default App
