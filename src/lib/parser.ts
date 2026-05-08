import type { ControllerSettings, MachineStatus, MachineState, Position } from '../types'

export function parseStatusReport(raw: string): Partial<MachineStatus> | null {
  if (!raw.startsWith('<') || !raw.endsWith('>')) return null
  const parts = raw.slice(1, -1).split('|')
  const status: Partial<MachineStatus> = {}

  const stateParts = parts[0].split(':')
  status.state = stateParts[0] as MachineState
  if (stateParts[0] === 'Alarm' && stateParts[1]) {
    status.alarmCode = parseInt(stateParts[1], 10)
  } else {
    status.alarmCode = undefined
  }

  status.feed = 0
  status.spindle = 0

  let hasSd = false
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]
    if (p.startsWith('WPos:')) {
      status.wpos = parsePos(p.slice(5))
    } else if (p.startsWith('MPos:')) {
      status.mpos = parsePos(p.slice(5))
    } else if (p.startsWith('WCO:')) {
      status.wco = parsePos(p.slice(4))
    } else if (p.startsWith('FS:')) {
      const [f, s] = p.slice(3).split(',').map(Number)
      status.feed = f ?? 0
      status.spindle = s ?? 0
    } else if (p.startsWith('Ov:')) {
      const [f, r, s] = p.slice(3).split(',').map(Number)
      status.feedOverride = f ?? 100
      status.rapidOverride = r ?? 100
      status.spindleOverride = s ?? 100
    } else if (p.startsWith('Pn:')) {
      status.pinState = p.slice(3)
    } else if (p.startsWith('SD:')) {
      hasSd = true
      const sdParts = p.slice(3).split(',')
      // FluidNC format: SD:percent,filename
      status.sdPercent = parseFloat(sdParts[0]) || 0
      if (sdParts.length > 1) status.sdFilename = sdParts.slice(1).join(',')
    }
  }
  if (!hasSd) {
    status.sdPercent = undefined
    status.sdFilename = undefined
  }

  return status
}

function parsePos(str: string): Position {
  const [x, y, z, a, b, c] = str.split(',').map(Number)
  return { x: x ?? 0, y: y ?? 0, z: z ?? 0, a, b, c }
}

export function parseESP800(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  raw.split('#').forEach(part => {
    const idx = part.indexOf(':')
    if (idx > -1) {
      result[part.slice(0, idx).trim()] = part.slice(idx + 1).trim()
    }
  })
  return result
}

export function parseGcStateLine(line: string): Partial<MachineStatus> | null {
  const match = line.match(/^\[GC:(.+)\]$/)
  if (!match) return null

  const words = match[1].trim().split(/\s+/)
  const modal = new Set(words)
  const spindleWord = words.find(word => /^S-?\d+(?:\.\d+)?$/.test(word))
  const spindleValue = spindleWord ? Number.parseFloat(spindleWord.slice(1)) : undefined

  if (modal.has('M5')) {
    return {
      spindleRunning: false,
      spindle: spindleValue ?? 0,
    }
  }

  if (modal.has('M3') || modal.has('M4')) {
    return {
      spindleRunning: true,
      ...(spindleValue != null ? { spindle: spindleValue } : {}),
    }
  }

  return null
}

const CONTROLLER_SETTING_MAP: Record<string, keyof ControllerSettings> = {
  '23': 'homingDirInvert',
  '30': 'spindleMax',
  '31': 'spindleMin',
  '110': 'maxRateX',
  '111': 'maxRateY',
  '112': 'maxRateZ',
  '130': 'maxTravelX',
  '131': 'maxTravelY',
  '132': 'maxTravelZ',
}

export function parseControllerSettingLine(line: string): Partial<ControllerSettings> | null {
  const match = line.match(/^\$(23|30|31|110|111|112|130|131|132)=(-?\d+(?:\.\d+)?)(?:\s|$)/)
  if (!match) return null

  const value = Number.parseFloat(match[2])
  if (!Number.isFinite(value)) return null

  return { [CONTROLLER_SETTING_MAP[match[1]]]: value }
}

export function classifyLine(line: string): 'error' | 'alarm' | 'info' | 'ok' | 'status' | 'normal' {
  if (line.startsWith('error:') || line.includes('[MSG:ERR')) return 'error'
  if (line.startsWith('ALARM:') || line.includes('[MSG:WARN')) return 'alarm'
  if (line.includes('[MSG:INFO')) return 'info'
  if (line === 'ok') return 'ok'
  if (line.startsWith('<') && line.endsWith('>')) return 'status'
  return 'normal'
}
