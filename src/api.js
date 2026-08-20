const BASE = 'https://hacker-news.firebaseio.com/v0'

// Categories mapped to Hacker News story-list endpoints.
export const CATEGORIES = [
  { id: 'top', label: 'top', endpoint: 'topstories' },
  { id: 'new', label: 'new', endpoint: 'newstories' },
  { id: 'best', label: 'best', endpoint: 'beststories' },
  { id: 'ask', label: 'ask', endpoint: 'askstories' },
  { id: 'show', label: 'show', endpoint: 'showstories' },
]

async function getJSON(url, signal) {
  const res = await fetch(url, { signal })
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
