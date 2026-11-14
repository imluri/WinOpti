import { useEffect, useRef } from 'react'

const sampleInterval = 1000

export function useLivePolling(request, enabled, onResult, onError) {
  const pending = useRef(null)

  useEffect(() => {
    if (!enabled || !request) return
    let stopped = false
    let running = false
    let timer

    async function poll() {
      if (running || stopped || document.hidden) return
      running = true
      const started = performance.now()
      try {
        if (!pending.current || pending.current.request !== request) {
          const entry = { request }
          entry.promise = Promise.resolve().then(request).finally(() => {
            if (pending.current === entry) pending.current = null
          })
          pending.current = entry
        }
        const result = await pending.current.promise
        if (!stopped && !document.hidden) onResult(result)
      } catch {
        if (!stopped && !document.hidden) onError()
      } finally {
        running = false
        if (!stopped && !document.hidden) {
          timer = setTimeout(poll, Math.max(150, sampleInterval - (performance.now() - started)))
        }
      }
    }

    function onVisibilityChange() {
      clearTimeout(timer)
      if (!document.hidden) void poll()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [request, enabled, onResult, onError])
}
