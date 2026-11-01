import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { message } from '../../lib/format'
import type { CreateEvaluation } from '../../types'

const LIMIT = 10_000

export function CustomAttackDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (request: CreateEvaluation) => Promise<void>
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [label, setLabel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [document, setDocument] = useState('')
  const [expected, setExpected] = useState<'blocked' | 'allowed' | ''>('blocked')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal()
    if (!open && ref.current?.open) ref.current.close()
  }, [open])

  const used = prompt.length + document.length
  const invalid = !prompt.trim()
    ? 'Enter a prompt.'
    : used > LIMIT
      ? `Over the ${LIMIT} character limit.`
      : null

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit({
        prompt,
        ...(document.trim() ? { document } : {}),
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(expected ? { expected_outcome: expected } : {}),
      })
      setPrompt('')
      setDocument('')
      setLabel('')
      onClose()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} className="dialog" onCancel={onClose} aria-labelledby="custom-title">
      <form onSubmit={(e) => void submit(e)}>
        <header className="card-head">
          <span className="kicker">Red · custom round</span>
          <h2 id="custom-title">Write your own attack</h2>
        </header>
        <label className="field">
          <span className="field-label">Name (optional)</span>
          <input value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Prompt</span>
          <textarea rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Attached document (optional, tests indirect injection)</span>
          <textarea rows={4} value={document} onChange={(e) => setDocument(e.target.value)} />
        </label>
        <fieldset className="field">
          <legend className="field-label">What should a good defense do?</legend>
          <div className="segmented">
            {(
              [
                ['blocked', 'Block it (attack)'],
                ['allowed', 'Allow it (normal)'],
                ['', 'No expectation'],
              ] as const
            ).map(([value, text]) => (
              <label key={value || 'none'} className={expected === value ? 'on' : ''}>
                <input
                  type="radio"
                  name="expected"
                  checked={expected === value}
                  onChange={() => setExpected(value)}
                />
                {text}
              </label>
            ))}
          </div>
        </fieldset>
        <p className={`counter ${used > LIMIT ? 'over' : ''}`}>
          {used.toLocaleString()} / {LIMIT.toLocaleString()} characters
        </p>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Sending…' : 'Fire round'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
