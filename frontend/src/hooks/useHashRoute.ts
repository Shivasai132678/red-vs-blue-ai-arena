import { useEffect, useState } from 'react'

export type Route = { view: 'arena' | 'log'; evaluationId?: string }

function readRoute(): Route {
  const [view, id] = window.location.hash.replace(/^#\/?/, '').split('/')
  if (view === 'log') {
    try {
      return { view, evaluationId: id ? decodeURIComponent(id) : undefined }
    } catch {
      return { view }
    }
  }
  return { view: 'arena' }
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    if (!window.location.hash) window.location.replace('#/arena')
    const update = () => setRoute(readRoute())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}
