const BASE = 'https://hacker-news.firebaseio.com/v0'

// Categories mapped to Hacker News story-list endpoints.
export const CATEGORIES = [
  { id: 'top', label: 'top', endpoint: 'topstories' },
  { id: 'new', label: 'new', endpoint: 'newstories' },
  { id: 'best', label: 'best', endpoint: 'beststories' },
  { id: 'ask', label: 'ask', endpoint: 'askstories' },
  { id: 'show', label: 'show', endpoint: 'showstories' },
]

// Fetch JSON with a hard timeout so a stalled request can never hang forever
// (which would otherwise leave the loading indicator stuck). The caller's abort
// signal and the timeout are combined; whichever fires first wins.
async function getJSON(url, signal, timeoutMs = 12000) {
  const signals = [AbortSignal.timeout(timeoutMs)]
  if (signal) signals.push(signal)
  const combined = signals.length > 1 ? AbortSignal.any(signals) : signals[0]
  const res = await fetch(url, { signal: combined })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

// Run async tasks with a bounded concurrency so we don't fire 200 requests at once.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

export async function fetchTopStories(endpoint, { count = 200, signal, onProgress } = {}) {
  const ids = await getJSON(`${BASE}/${endpoint}.json`, signal)
  const top = (ids || []).slice(0, count)
  let done = 0
  const items = await mapWithConcurrency(top, 12, async (id) => {
    try {
      const item = await getJSON(`${BASE}/item/${id}.json`, signal)
      return item
    } catch {
      return null
    } finally {
      done++
      onProgress?.(done, top.length)
    }
  })
  return items.filter((it) => it && !it.deleted && !it.dead)
}
