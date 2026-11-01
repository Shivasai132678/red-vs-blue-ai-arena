import { useCallback, useEffect, useRef, useState } from 'react'
import { message } from '../lib/format'
export function useResource<T>(loader: () => Promise<T>, interval?: (data: T) => number | false) {
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{
    loader: typeof loader
    revision: number
    data: T | null
    error: string | null
  } | null>(null)
  const intervalRef = useRef(interval)
  useEffect(() => {
    intervalRef.current = interval
  }, [interval])
  const reload = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      try {
        const data = await loader()
        if (!active) return
        setResult({ loader, revision, data, error: null })
        const delay = intervalRef.current?.(data)
        if (delay)
          timer = setTimeout(() => {
            void run()
          }, delay)
      } catch (err) {
        if (active)
          setResult((previous) => ({
            loader,
            revision,
            data: previous?.loader === loader && previous.revision === revision ? previous.data : null,
            error: message(err),
          }))
      }
    }
    void run()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [revision, loader])
  const current = result?.loader === loader && result.revision === revision ? result : null
  return { data: current?.data ?? null, error: current?.error ?? null, loading: current === null, reload }
}
