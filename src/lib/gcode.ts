/** Lightweight G-code parser – extracts toolpath segments for 2D visualisation. */

export interface Segment {
  x0: number; y0: number; z0: number
  x1: number; y1: number; z1: number
  /**
   * G0 move = 'rapid'
   * G1/G2/G3 while spindle is on (or no spindle machine) = 'feed'
   * G1/G2/G3 while spindle is off on a spindle machine = 'traverse'
   */
  moveType: 'rapid' | 'feed' | 'traverse'
  /** For arcs: center offsets (relative to start). undefined for lines. */
  i?: number; j?: number; k?: number
  /** true = clockwise arc (G2) */
  cw?: boolean
}

export interface GCodeModel {
  segments: Segment[]
  bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
  totalLines: number
}

/** Map segment index → approximate source-line fraction (0..1) */
export function segmentProgress(idx: number, total: number): number {
  return total > 0 ? idx / total : 0
}

export function parseGCode(text: string): GCodeModel {
  const segments: Segment[] = []
  let x = 0, y = 0, z = 0
  let offX = 0, offY = 0, offZ = 0        // G92 coordinate offsets
  let rapid = true
  let arcMode: 0 | 2 | 3 = 0   // 0 = linear, 2 = CW arc, 3 = CCW arc
  let plane = 17               // G17=XY, G18=ZX, G19=YZ
  let incremental = false
  let spindleOn = false        // Track spindle state
  let spindleEverOn = false    // Whether spindle was ever activated (false = no spindle machine e.g. pen plotter)
  const bounds = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity }

  function getMoveType(): 'rapid' | 'feed' | 'traverse' {
    if (rapid) return 'rapid'
    if (spindleEverOn && !spindleOn) return 'traverse'
    return 'feed'
  }

  function expandBounds(px: number, py: number, pz: number) {
    if (px < bounds.minX) bounds.minX = px
    if (px > bounds.maxX) bounds.maxX = px
    if (py < bounds.minY) bounds.minY = py
    if (py > bounds.maxY) bounds.maxY = py
    if (pz < bounds.minZ) bounds.minZ = pz
    if (pz > bounds.maxZ) bounds.maxZ = pz
  }

  const lines = text.split('\n')
  for (const raw of lines) {
    const line = raw.split(';')[0].split('(')[0].trim().toUpperCase()
    if (!line) continue

    // Parse words
    const words: Record<string, number> = {}
    let gCodes: number[] = []
    let mCodes: number[] = []
    const re = /([A-Z])(-?(?:\d+\.?\d*|\.\d+))/g
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      const letter = m[1]
      const val = parseFloat(m[2])
      if (letter === 'G') {
        gCodes.push(val)
      } else if (letter === 'M') {
        mCodes.push(val)
      } else {
        words[letter] = val
      }
    }

    // Process M codes (spindle control)
    for (const mc of mCodes) {
      if (mc === 3 || mc === 4) { spindleOn = true; spindleEverOn = true }  // M3/M4 = spindle on
      else if (mc === 5) { spindleOn = false }        // M5 = spindle off
    }

    // Process G codes
    for (const g of gCodes) {
      if (g === 90) { incremental = false; continue }
      if (g === 91) { incremental = true; continue }
      if (g === 17 || g === 18 || g === 19) { plane = g; continue }
      if (g === 0) { rapid = true; arcMode = 0 }
      else if (g === 1) { rapid = false; arcMode = 0 }
      else if (g === 2) { rapid = false; arcMode = 2 }
      else if (g === 3) { rapid = false; arcMode = 3 }
    }

    // G92 – set coordinate offset
    if (gCodes.includes(92)) {
      offX = x - (words.X ?? x)
      offY = y - (words.Y ?? y)
      offZ = z - (words.Z ?? z)
      continue
    }

    if (gCodes.includes(28)) {
      const x0 = x, y0 = y, z0 = z
      if ('X' in words || 'Y' in words || 'Z' in words) {
        x = (words.X ?? x) + offX
        y = (words.Y ?? y) + offY
        z = (words.Z ?? z) + offZ
        expandBounds(x0, y0, z0)
        expandBounds(x, y, z)
        segments.push({ x0, y0, z0, x1: x, y1: y, z1: z, moveType: 'rapid' })
      }
      const xi = x, yi = y, zi = z
      x = 0; y = 0; z = 0
      expandBounds(xi, yi, zi)
      expandBounds(x, y, z)
      segments.push({ x0: xi, y0: yi, z0: zi, x1: x, y1: y, z1: z, moveType: 'rapid' })
      continue
    }

    const hasMove = 'X' in words || 'Y' in words || 'Z' in words
    const xyPlane = plane === 17
    const isArc = xyPlane && (gCodes.includes(2) || gCodes.includes(3) || (arcMode > 0 && hasMove && ('I' in words || 'J' in words || 'R' in words)))

    if (hasMove || isArc) {
      const x0 = x, y0 = y, z0 = z

      if (incremental) {
        x += words.X ?? 0
        y += words.Y ?? 0
        z += words.Z ?? 0
      } else {
        x = (words.X ?? (x - offX)) + offX
        y = (words.Y ?? (y - offY)) + offY
        z = (words.Z ?? (z - offZ)) + offZ
      }

      expandBounds(x0, y0, z0)
      expandBounds(x, y, z)

      if (isArc) {
        const cw = gCodes.includes(2) || (!gCodes.includes(3) && arcMode === 2)
        let i: number, j: number, k: number = 0
        if ('R' in words) {
          // R-format arc: compute I/J from radius
          const R = words.R
          const dx = x - x0, dy = y - y0
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d > 0) {
            const h = Math.sqrt(Math.max(0, R * R - (d * d) / 4))
            const sign = ((R > 0) !== cw) ? 1 : -1
            i = dx / 2 + sign * h * (-dy / d)
            j = dy / 2 + sign * h * (dx / d)
          } else {
            i = 0; j = 0
          }
        } else {
          i = words.I ?? 0
          j = words.J ?? 0
          k = words.K ?? 0
        }

        // Skip arcs with zero radius (degenerate)
        const r = Math.sqrt(i * i + j * j + k * k)
        if (r > 1e-6) {
          // Expand bounds for arc extent (approximate with center + radius)
          const cx = x0 + i, cy = y0 + j, cz = z0 + k
          expandBounds(cx - r, cy - r, cz - r)
          expandBounds(cx + r, cy + r, cz + r)
          segments.push({ x0, y0, z0, x1: x, y1: y, z1: z, moveType: getMoveType(), i, j, k, cw })
        } else {
          // Treat degenerate arc as a line
          segments.push({ x0, y0, z0, x1: x, y1: y, z1: z, moveType: getMoveType() })
        }
      } else {
        segments.push({ x0, y0, z0, x1: x, y1: y, z1: z, moveType: getMoveType() })
      }
    }
  }

  // Handle degenerate case
  if (!isFinite(bounds.minX)) {
    bounds.minX = bounds.minY = bounds.minZ = 0
    bounds.maxX = bounds.maxY = bounds.maxZ = 1
  }

  return { segments, bounds, totalLines: segments.length }
}
