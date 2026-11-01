import type { ReactNode } from 'react'
export function Panel({
  title,
  children,
  action,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
export function ErrorState({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <p>{error}</p>
      {retry && <button onClick={retry}>Try again</button>}
    </div>
  )
}
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {children}
    </div>
  )
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="loading-dot" />
      Loading evidence…
    </div>
  )
}
export function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="code-block" tabIndex={0}>
      {children}
    </pre>
  )
}
