import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES, fetchTopStories } from './api'
import { squarifiedTreemap } from './treemap'

const HN_ITEM = 'https://news.ycombinator.com/item?id='
const REPO_URL = 'https://github.com/Livinglist/hacker-news-heatmap'

function GithubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="1.2em" height="1.2em" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

// Metrics we can color the heatmap by.
const METRICS = [
  { id: 'score', label: 'Points' },
  { id: 'descendants', label: 'Comments' },
]

// Map a normalized value [0,1] to a heat color (cool navy -> HN orange -> hot
// yellow), returned as an [r,g,b] array.
function heatRGB(t) {
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
  return a.map((v, k) => Math.round(v + (b[k] - v) * f))
}

function heatColor(t) {
  const c = heatRGB(t)
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

// Every tile uses the same black text.
const TILE_TEXT = '#1a1a1a'

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

// Renders text at its target size (`max`), shrinking only if the full title
// wouldn't otherwise fit the box. It never grows past `max`, so a short title
// is not enlarged just because it has fewer characters — size tracks the tile
// (i.e. the post's points/comments), not the title length.
function FitText({ text, min = 6.5, max = 22 }) {
  const boxRef = useRef(null)
  const textRef = useRef(null)

  useLayoutEffect(() => {
    const box = boxRef.current
    const el = textRef.current
    if (!box || !el) return

    const fit = () => {
      const availW = box.clientWidth
      const availH = box.clientHeight
      if (!availW || !availH) return
      const fitsAt = (size) => {
        el.style.fontSize = `${size}px`
        return el.scrollWidth <= availW + 0.5 && el.scrollHeight <= availH + 0.5
      }
      // Target size first: if the whole title fits at `max`, keep it there.
      if (fitsAt(max)) {
        el.style.fontSize = `${max}px`
        return
      }
      // Otherwise shrink just enough to fit.
      let lo = min
      let hi = max
      let best = min
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2
        if (fitsAt(mid)) {
          best = mid
          lo = mid
        } else {
          hi = mid
        }
      }
      el.style.fontSize = `${best}px`
    }

    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(box)
    return () => ro.disconnect()
  }, [text, min, max])

  return (
    <span className="tile-title" ref={boxRef}>
      <span className="fit-inner" ref={textRef}>
        {text}
      </span>
    </span>
  )
}

export default function App() {
  const [category, setCategory] = useState('top')
  const [metric, setMetric] = useState('score')
  const [stories, setStories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [hover, setHover] = useState(null) // { story, x, y }
  const reqIdRef = useRef(0)
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
        // Desktop: fill the remaining viewport height below the treemap's top,
        // so the heatmap reaches the bottom of the window. Uses the container's
        // document offset (scroll-independent) and re-runs on every resize.
        const docTop = el.getBoundingClientRect().top + window.scrollY
        // Reserve space below for the legend + a small gap.
        h = Math.max(360, window.innerHeight - docTop - 64)
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
    // Each run gets a monotonic id; only the LATEST request may touch state.
    // This is robust against any abort/resolve interleaving when switching
    // categories quickly — a superseded request can neither overwrite the data
    // nor leave the loading indicator stuck.
    const reqId = ++reqIdRef.current
    const isCurrent = () => reqId === reqIdRef.current
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setStories([])
    setProgress({ done: 0, total: 0 })

    fetchTopStories(cat.endpoint, {
      count: 100,
      signal: controller.signal,
      onProgress: (done, total) => {
        if (isCurrent()) setProgress({ done, total })
      },
    })
      .then((items) => {
        if (!isCurrent()) return
        setStories(items)
        setLoading(false)
      })
      .catch((err) => {
        if (!isCurrent() || err.name === 'AbortError') return
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
                const dark = t > 0.5
                // On mobile every tile shows its title; desktop keeps the
                // size threshold so tiny cold tiles stay clean.
                const showTitle = isMobile || (tile.w > 62 && tile.h > 40)
                const showValue = tile.w > 36 && tile.h > 26
                // Target title size scales with the TILE size (i.e. the post's
                // score/comments), capped — so hotter posts get bigger titles,
                // but a short title never balloons past this cap.
                const titleCap = Math.max(9, Math.min(24, Math.sqrt(tile.w * tile.h) * 0.13))
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
                    {showTitle && <FitText key={s.id} text={s.title || ''} max={titleCap} />}
                    {showValue && (
                      <span className="tile-value">
                        {metric === 'score' ? (
                          <span className="tile-up">▲</span>
                        ) : (
                          <span className="material-symbols-outlined">mode_comment</span>
                        )}
                        {v}
                      </span>
                    )}
                  </a>
                )
              })}
            </div>

            <div className="legend">
              <span className="legend-label">{minValue}</span>
              <div className="legend-bar" />
              <span className="legend-label">{maxValue}</span>
              <a className="source-link" href={REPO_URL} target="_blank" rel="noreferrer">
                <GithubIcon />
                Source code
              </a>
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
            <span>
              <span className="material-symbols-outlined">mode_comment</span>
              {hover.story.descendants || 0}
            </span>
            <span>
              <span className="material-symbols-outlined">schedule</span>
              {timeAgo(hover.story.time)}
            </span>
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
