// Squarified treemap (Bruls, Huizing, van Wijk) — lays out rectangles whose
// AREA is proportional to each item's value, packed to stay close to square.
// Returns an array of { x, y, w, h, value, id, index } in the ORIGINAL input order.

function worstRatio(row, side) {
  const sum = row.reduce((s, r) => s + r._area, 0)
  let max = -Infinity
  let min = Infinity
  for (const r of row) {
    if (r._area > max) max = r._area
    if (r._area < min) min = r._area
  }
  const s2 = sum * sum
  const side2 = side * side
  return Math.max((side2 * max) / s2, s2 / (side2 * min))
}

export function squarifiedTreemap(data, width, height) {
  if (width <= 0 || height <= 0 || data.length === 0) return []

  const nodes = data.map((d, i) => ({ ...d, _i: i }))
  const totalValue = nodes.reduce((s, n) => s + Math.max(n.areaValue, 0), 0) || 1
  const totalArea = width * height
  nodes.forEach((n) => {
    n._area = (Math.max(n.areaValue, 0) / totalValue) * totalArea
  })

  const sorted = [...nodes].sort((a, b) => b._area - a._area)
  const result = new Array(data.length)
  const rect = { x: 0, y: 0, w: width, h: height }

  const shortest = () => Math.min(rect.w, rect.h)

  function layoutRow(row) {
    const sum = row.reduce((s, r) => s + r._area, 0)
    if (rect.w >= rect.h) {
      const rw = sum / rect.h
      let ry = rect.y
      for (const r of row) {
        const rh = rw > 0 ? r._area / rw : 0
        result[r._i] = { x: rect.x, y: ry, w: rw, h: rh, value: r.value, id: r.id, index: r._i }
        ry += rh
      }
      rect.x += rw
      rect.w -= rw
    } else {
      const rh = sum / rect.w
      let rx = rect.x
      for (const r of row) {
        const rww = rh > 0 ? r._area / rh : 0
        result[r._i] = { x: rx, y: rect.y, w: rww, h: rh, value: r.value, id: r.id, index: r._i }
        rx += rww
      }
      rect.y += rh
      rect.h -= rh
    }
  }

  let row = []
  let i = 0
  while (i < sorted.length) {
    const node = sorted[i]
    if (row.length === 0) {
      row.push(node)
      i++
      continue
    }
    const side = shortest()
    const withNode = [...row, node]
    if (worstRatio(row, side) >= worstRatio(withNode, side)) {
      row = withNode
      i++
    } else {
      layoutRow(row)
      row = []
    }
  }
  if (row.length) layoutRow(row)

  return result
}
