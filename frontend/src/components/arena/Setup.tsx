import { useMemo, useState } from 'react'
import type { Category, Scenario, ScenarioResponse, StatusResponse } from '../../types'
import { categoryLabels, time } from '../../lib/format'
import { LAYER_SHORT } from '../../lib/layers'

const ATTACK_ORDER: Category[] = [
  'direct_injection',
  'indirect_injection',
  'secret_extraction',
  'encoded_instruction',
]
const TRAFFIC_ORDER: Category[] = ['normal_request', 'benign_document']

export function Setup({
  status,
  statusError,
  verifying,
  onVerify,
  library,
  libraryError,
  starting,
  error,
  onStart,
  onCustom,
}: {
  status: StatusResponse | null
  statusError: string | null
  verifying: boolean
  onVerify: () => void
  library: ScenarioResponse | null
  libraryError: string | null
  starting: boolean
  error: string | null
  onStart: (scenarios: Scenario[]) => void
  onCustom: () => void
}) {
  const [enabled, setEnabled] = useState<Set<Category>>(new Set([...ATTACK_ORDER, ...TRAFFIC_ORDER]))
  const counts = useMemo(() => {
    const map = new Map<Category, number>()
    for (const s of library?.scenarios ?? []) map.set(s.category, (map.get(s.category) ?? 0) + 1)
    return map
  }, [library])
  const selected = (library?.scenarios ?? []).filter((s) => enabled.has(s.category))
  const toggle = (c: Category) =>
    setEnabled((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })

  const v = status?.azure.verification
  return (
    <div className="setup">
      <section className="card loadout">
        <header className="card-head">
          <span className="kicker">Blue · defense loadout</span>
          <h2>Shield layers</h2>
        </header>
        {statusError && !status ? (
          <p className="notice notice-error">Server unreachable: {statusError}</p>
        ) : (
          <>
            <div className="link-status">
              <div>
                <span className="field-label">Azure AI Content Safety</span>
                <span className="mono">{status?.azure.endpoint_host ?? 'not configured'}</span>
              </div>
              <dl>
                <div>
                  <dt>Credentials</dt>
                  <dd className={status?.azure.configured ? 'ok' : 'bad'}>
                    {status?.azure.configured ? 'Configured' : 'Missing'}
                  </dd>
                </div>
                <div>
                  <dt>Connection</dt>
                  <dd className={v?.state === 'verified' ? 'ok' : v?.state === 'failed' ? 'bad' : 'muted'}>
                    {v?.state === 'verified'
                      ? `Verified ${v.checked_at ? time(v.checked_at).split(', ').pop() : ''}`
                      : v?.state === 'failed'
                        ? 'Failed'
                        : 'Not yet tested'}
                  </dd>
                </div>
              </dl>
              <button
                className="btn btn-ghost"
                onClick={onVerify}
                disabled={verifying || !status?.azure.configured}
              >
                {verifying ? 'Testing…' : 'Test connection'}
              </button>
            </div>
            {v?.state === 'failed' && v.message && <p className="notice notice-error">{v.message}</p>}
            <ol className="layer-list">
              {(status?.checks ?? []).map((c) => (
                <li key={c.id} className={c.configured ? '' : 'layer-off'}>
                  <span className="layer-index">{String(c.order).padStart(2, '0')}</span>
                  <div>
                    <strong>
                      {LAYER_SHORT[c.id] ?? c.name}
                      <span className={`source-pill source-${c.source}`}>
                        {c.source === 'azure' ? 'Azure' : 'Local rule'}
                      </span>
                      {!c.configured && <span className="source-pill source-off">Not configured</span>}
                    </strong>
                    <p>{c.description}</p>
                  </div>
                </li>
              ))}
            </ol>
            {status && <p className="fine-print">{status.model.note}</p>}
          </>
        )}
      </section>

      <section className="card playlist">
        <header className="card-head">
          <span className="kicker">Red · attack playlist</span>
          <h2>Choose the rounds</h2>
        </header>
        {libraryError ? (
          <p className="notice notice-error">Could not load scenarios: {libraryError}</p>
        ) : (
          <>
            <p className="field-label">Attacks</p>
            <div className="chips">
              {ATTACK_ORDER.map((c) => (
                <Chip key={c} on={enabled.has(c)} onClick={() => toggle(c)} tone="red">
                  {categoryLabels[c]} <span>{counts.get(c) ?? 0}</span>
                </Chip>
              ))}
            </div>
            <p className="field-label">Normal traffic (false-positive probes)</p>
            <div className="chips">
              {TRAFFIC_ORDER.map((c) => (
                <Chip key={c} on={enabled.has(c)} onClick={() => toggle(c)} tone="neutral">
                  {categoryLabels[c]} <span>{counts.get(c) ?? 0}</span>
                </Chip>
              ))}
            </div>
            {error && <p className="notice notice-error">{error}</p>}
            <div className="playlist-actions">
              <button
                className="btn btn-primary btn-start"
                disabled={!selected.length || starting || !library}
                onClick={() => onStart(selected)}
              >
                {starting ? 'Starting…' : `Start match · ${selected.length} rounds`}
              </button>
              <button className="btn btn-ghost" onClick={onCustom} disabled={starting}>
                Write your own attack
              </button>
            </div>
            <p className="fine-print">
              Every round is a live evaluation against your Azure resource. Results apply to this scenario set
              only.
            </p>
          </>
        )}
      </section>
    </div>
  )
}

function Chip({
  on,
  onClick,
  tone,
  children,
}: {
  on: boolean
  onClick: () => void
  tone: 'red' | 'neutral'
  children: React.ReactNode
}) {
  return (
    <button className={`chip chip-${tone} ${on ? 'chip-on' : ''}`} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  )
}
