// In-memory filesystem for demo mode — pre-populated with sample files

interface Entry { content: string; isDir: boolean }

const fs = new Map<string, Entry>([
  ['/sd/demo.gcode', { isDir: false, content: `; FigUI Demo G-code
G21         ; mm mode
G90         ; absolute positioning
G0 Z5 F3000 ; safe height
G0 X0 Y0
G1 Z-1 F100 ; plunge
G1 X50 F500
G1 Y50
G1 X0
G1 Y0
G0 Z5
M5
M30
` }],
  ['/sd/square.gcode', { isDir: false, content: `; Simple square pocket
G21 G90 G17
G0 Z5
G0 X10 Y10
G1 Z-2 F100
G1 X40 F600
G1 Y40
G1 X10
G1 Y10
G0 Z5
M30
` }],
  ['/sd/circle.gcode', { isDir: false, content: `; Circle arc demo
G21 G90
G0 Z5 F3000
G0 X25 Y0
G1 Z-1 F100
G2 X25 Y0 I-25 J0 F400
G0 Z5
M30
` }],
  ['/localfs/config.yaml', { isDir: false, content: `# FluidNC Simulator Config
name: FigUI Demo Machine
board: 6 Pack

axes:
  shared_stepper_disable_pin: gpio.2

  x:
    steps_per_mm: 200
    max_rate_mm_per_min: 5000
    acceleration_mm_per_sec2: 200
    max_travel_mm: 300
    motor0:
      stepstick:
        step_pin: gpio.12
        direction_pin: gpio.14

  y:
    steps_per_mm: 200
    max_rate_mm_per_min: 5000
    acceleration_mm_per_sec2: 200
    max_travel_mm: 300
    motor0:
      stepstick:
        step_pin: gpio.26
        direction_pin: gpio.27

  z:
    steps_per_mm: 400
    max_rate_mm_per_min: 1500
    acceleration_mm_per_sec2: 80
    max_travel_mm: 100
    motor0:
      stepstick:
        step_pin: gpio.15
        direction_pin: gpio.2
` }],
])

export function getFile(path: string): string | null {
  const e = fs.get(path)
  return e && !e.isDir ? e.content : null
}

export function setFile(path: string, content: string): void {
  fs.set(path, { isDir: false, content })
}

export function deleteEntry(path: string): void {
  fs.delete(path)
  for (const k of fs.keys()) {
    if (k.startsWith(path + '/')) fs.delete(k)
  }
}

export function renameEntry(from: string, to: string): void {
  const e = fs.get(from)
  if (e) { fs.set(to, e); fs.delete(from) }
}

export function listDir(prefix: string): Array<{ name: string; size: number; isDir: boolean }> {
  const seen = new Set<string>()
  const result: Array<{ name: string; size: number; isDir: boolean }> = []
  const norm = prefix.endsWith('/') ? prefix : `${prefix}/`

  for (const [path, entry] of fs) {
    if (!path.startsWith(norm)) continue
    const rel = path.slice(norm.length)
    if (!rel) continue
    const name = rel.split('/')[0]
    if (seen.has(name)) continue
    seen.add(name)
    const isDir = rel.includes('/')
    result.push({ name, size: isDir ? -1 : new TextEncoder().encode(entry.content).length, isDir })
  }

  return result.sort((a, b) => a.name.localeCompare(b.name))
}

export function diskStats() {
  const total = 16 * 1024 * 1024
  let used = 0
  for (const [, e] of fs) used += new TextEncoder().encode(e.content).length
  return { total, used, occupation: Math.round((used / total) * 100) }
}
