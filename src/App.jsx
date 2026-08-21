import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES, fetchTopStories } from './api'
import { squarifiedTreemap } from './treemap'

const HN_ITEM = 'https://news.ycombinator.com/item?id='

// Metrics we can color the heatmap by.
const METRICS = [
  { id: 'score', label: 'Points' },
  { id: 'descendants', label: 'Comments' },
]

// Map a normalized value [0,1] to a heat color (cool navy -> HN orange -> hot yellow).
function heatColor(t) {
  const stops = [
    [13, 17, 38],     // deep navy
    [40, 30, 90],     // indigo
    [140, 40, 90],    // magenta
    [220, 70, 40],    // red-orange
    [255, 102, 0],    // HN orange
    [255, 196, 60],   // amber
    [255, 244, 150],  // pale yellow
  ]
  const clamped = Math.max(0, Math.min(1, t))
  const pos = clamped * (stops.length - 1)
  const i = Math.floor(pos)
  const f = pos - i
  const a = stops[i]
  const b = stops[Math.min(i + 1, stops.length - 1)]
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

function timeAgo(unixSeconds) {
  if (!unixSeconds) return ''
  const diff = Date.now() / 1000 - unixSeconds
  const mins = Math.floor(diff / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function domainOf(url) {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export default function App() {
  const [category, setCategory] = useState('top')
  const [metric, setMetric] = useState('score')
  const [stories, setStories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [hover, setHover] = useState(null) // { story, x, y }
  const abortRef = useRef(null)
  const mapRef = useRef(null)
  const [mapSize, setMapSize] = useState({ w: 0, h: 0 })
  const [isMobile, setIsMobile] = useState(false)

  const cat = CATEGORIES.find((c) => c.id === category)

  // Measure the treemap container and keep it in sync on resize.
  useLayoutEffect(() => {
    const el = mapRef.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth
      const mobile = window.innerWidth < 768
      let h
      if (mobile) {
        // Size the height off the tile COUNT so each tile is readable — aim for
        // ~3 tiles across. The treemap fully fills the rectangle, so
        // average tile area = w*h/count; solve for h given a target tile size.
        const count = Math.max(stories.length, 1)
        const perRow = 3
        const tile = w / perRow
        h = (tile * tile * count) / w
      } else {
        h = Math.max(520, Math.min(w * 0.58, window.innerHeight - 220))
      }
      setIsMobile(mobile)
      setMapSize({ w, h })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [loading, stories.length])

  useEffect(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    setStories([])
    setProgress({ done: 0, total: 0 })

    fetchTopStories(cat.endpoint, {
      count: 100,
      signal: controller.signal,
      onProgress: (done, total) => setProgress({ done, total }),
    })
      .then((items) => {
        setStories(items)
        setLoading(false)
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setError(err.message || 'Failed to load')
        setLoading(false)
      })

    return () => controller.abort()
  }, [category])

  const values = useMemo(() => stories.map((s) => s[metric] || 0), [stories, metric])
  const maxValue = useMemo(() => (values.length ? Math.max(...values) : 1), [values])
  const minValue = useMemo(() => (values.length ? Math.min(...values) : 0), [values])
  // Color is RELATIVE to the selected category's range: the lowest-scoring post
  // maps to the coldest color, the highest to the hottest. Log scale so a few
  // huge scores don't wash out the middle of the pack.
  const norm = (v) => {
    const lo = Math.log1p(minValue)
    const hi = Math.log1p(maxValue)
    if (hi <= lo) return 0.5
    return (Math.log1p(v) - lo) / (hi - lo)
  }

  // Treemap: tile AREA grows strongly with the metric so hot posts clearly
  // dominate. A modest floor keeps the coldest posts from disappearing while
  // preserving a big hot/cold size contrast. Color also encodes heat (below).
  const tiles = useMemo(() => {
    if (!mapSize.w || !mapSize.h || stories.length === 0) return []
    const EXP = 0.82 // closer to linear = more dramatic size difference
    const scaled = (v) => Math.pow(Math.max(v, 0), EXP)
    // Bigger floor on mobile lifts the coldest tiles to a title-friendly size;
    // desktop keeps the small floor for a stronger hot/cold size contrast.
    const floor = scaled(maxValue) * (isMobile ? 0.16 : 0.035)
    const data = stories.map((s, i) => ({
      id: s.id,
      value: s[metric] || 0,
      areaValue: scaled(s[metric] || 0) + floor,
      index: i,
    }))
    return squarifiedTreemap(data, mapSize.w, mapSize.h)
  }, [stories, metric, maxValue, mapSize, isMobile])

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="https://news.ycombinator.com" target="_blank" rel="noreferrer">
            <span className="logo">Y</span>
            <span className="brand-name">Hacker News Heatmap</span>
          </a>
          <nav className="nav">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                className={`nav-item ${c.id === category ? 'active' : ''}`}
                onClick={() => setCategory(c.id)}
              >
                {c.label}
              </button>
            ))}
          </nav>
          <div className="metric-toggle">
            {METRICS.map((m) => (
              <button
                key={m.id}
                className={`metric-btn ${m.id === metric ? 'active' : ''}`}
                onClick={() => setMetric(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="content">
        <div className="subhead">
          <h1>
            Top {Math.min(100, stories.length || 100)} <strong>{cat.label}</strong> posts
          </h1>
          <p className="hint">
            Each tile is a post. Bigger &amp; hotter ={' '}
            {metric === 'score' ? 'more points' : 'more comments'}. Hover for details, click to open
            the discussion.
          </p>
        </div>

        {loading && (
          <div className="status">
            <div className="spinner" />
            <div>
              Loading posts… {progress.total ? `${progress.done}/${progress.total}` : ''}
            </div>
          </div>
        )}

        {error && (
          <div className="status error">
            Couldn’t load posts: {error}
          </div>
        )}

        {!loading && !error && (
          <>
            <div
              className="treemap"
              ref={mapRef}
              style={{ height: mapSize.h || 520 }}
              onMouseLeave={() => setHover(null)}
            >
              {tiles.map((tile) => {
                const s = stories[tile.index]
                if (!s) return null
                const v = tile.value
                const t = norm(v)
                const bg = heatColor(t)
                const dark = t > 0.62
                // On mobile every tile shows its title; desktop keeps the
                // size threshold so tiny cold tiles stay clean.
                const showTitle = isMobile || (tile.w > 62 && tile.h > 40)
                const showValue = tile.w > 36 && tile.h > 26
                // Title grows slightly with tile size; larger tiles = bigger text.
                const titleSize = Math.max(
                  11,
                  Math.min(22, Math.round(11 + (Math.min(tile.w, tile.h) - 60) / 11)),
                )
                const lineHeightPx = Math.round(titleSize * 1.2)
                // Fit as many title lines as the tile height allows.
                const titleLines = Math.max(1, Math.floor((tile.h - 24) / lineHeightPx))
                return (
                  <a
                    key={s.id}
                    className="tile"
                    href={HN_ITEM + s.id}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      left: tile.x,
                      top: tile.y,
                      width: Math.max(0, tile.w - 3),
                      height: Math.max(0, tile.h - 3),
                      background: bg,
                      color: dark ? '#1a1200' : '#fff',
                    }}
                    onMouseEnter={(e) =>
                      setHover({ story: s, rank: tile.index + 1, x: e.clientX, y: e.clientY })
                    }
                    onMouseMove={(e) =>
                      setHover({ story: s, rank: tile.index + 1, x: e.clientX, y: e.clientY })
                    }
                  >
                    <span className="tile-rank">{tile.index + 1}</span>
                    {showTitle && (
                      <span
                        className="tile-title"
                        style={{
                          WebkitLineClamp: titleLines,
                          fontSize: titleSize,
                          lineHeight: `${lineHeightPx}px`,
                        }}
                      >
                        {s.title}
                      </span>
                    )}
                    {showValue && <span className="tile-value">{v}</span>}
                  </a>
                )
              })}
            </div>

            <div className="legend">
              <span className="legend-label">{minValue}</span>
              <div className="legend-bar" />
              <span className="legend-label">{maxValue}</span>
              <span className="legend-count">
                {stories.length} posts · color relative to this category ·{' '}
                {metric === 'score' ? 'points' : 'comments'}
              </span>
            </div>
          </>
        )}
      </main>

      {hover && (
        <div
          className="tooltip"
          style={{
            left: Math.min(hover.x + 14, window.innerWidth - 340),
            top: Math.min(hover.y + 14, window.innerHeight - 140),
          }}
        >
          <div className="tt-title">
            <span className="tt-rank">#{hover.rank}</span> {hover.story.title}
          </div>
          <div className="tt-meta">
            <span className="tt-score">▲ {hover.story.score || 0} points</span>
            <span>💬 {hover.story.descendants || 0}</span>
            <span>{timeAgo(hover.story.time)}</span>
          </div>
          <div className="tt-sub">
            by {hover.story.by}
            {domainOf(hover.story.url) ? ` · ${domainOf(hover.story.url)}` : ''}
          </div>
        </div>
      )}
    </div>
  )
}
