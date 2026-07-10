import { useEffect, useRef, useState } from 'react'
import { ChevronDown, CircleDot, Crosshair, OctagonX, Target } from 'lucide-react'
import { onLine, sendRaw, sendRealtime } from '../lib/ws'
import { useMachineStore } from '../store'
import { displayToMm, feedUnitLabel, linearUnitLabel, mmToDisplay } from '../lib/units'

type Axis = 'X' | 'Y' | 'Z'
type Side = 'negative' | 'positive'
type CycleId = 'z-surface' | 'x-negative' | 'x-positive' | 'y-negative' | 'y-positive'
  | 'x-center' | 'y-center' | 'bore-center' | 'rectangle-center'

interface ProbePoint { x: number; y: number; z: number }
interface RunningCycle { id: CycleId; phase: string; first?: number }

const CYCLES: Array<{ id: CycleId; label: string; short: string; group: 'edge' | 'center' }> = [
  { id: 'z-surface', label: 'Z surface', short: 'Z−', group: 'edge' },
  { id: 'x-negative', label: 'Probe X−', short: 'X−', group: 'edge' },
  { id: 'x-positive', label: 'Probe X+', short: 'X+', group: 'edge' },
  { id: 'y-negative', label: 'Probe Y−', short: 'Y−', group: 'edge' },
  { id: 'y-positive', label: 'Probe Y+', short: 'Y+', group: 'edge' },
  { id: 'x-center', label: 'X center', short: 'X ⊕', group: 'center' },
  { id: 'y-center', label: 'Y center', short: 'Y ⊕', group: 'center' },
  { id: 'bore-center', label: 'Bore center', short: '○ ⊕', group: 'center' },
  { id: 'rectangle-center', label: 'Rectangle center', short: '▭ ⊕', group: 'center' },
]

function usePersisted<T>(key: string, init: T): [T, (v: T) => void] {
  const [val, setVal] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) return JSON.parse(raw) as T
    } catch { /* use default */ }
    return init
  })
  function persist(v: T) {
    localStorage.setItem(key, JSON.stringify(v))
    setVal(v)
  }
  return [val, persist]
}

function number(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(4)) : 0
}

function parseProbePoint(line: string): ProbePoint | null {
  const match = line.match(/^\[PRB:([+-]?[\d.]+),([+-]?[\d.]+),([+-]?[\d.]+):1\]$/i)
  if (!match) return null
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) }
}

function axisValue(point: ProbePoint, axis: Axis) {
  return point[axis.toLowerCase() as keyof ProbePoint]
}

function moveWord(axis: Axis, side: Side, distance: number) {
  return `${axis}${side === 'negative' ? '-' : ''}${number(distance)}`
}

function ProbeGraphic({ cycle }: { cycle: CycleId }) {
  const isZ = cycle === 'z-surface'
  const isBore = cycle === 'bore-center'
  const isRectangle = cycle === 'rectangle-center'
  const centerAxis = cycle === 'x-center' ? 'X' : cycle === 'y-center' ? 'Y' : null
  const side = cycle.includes('negative') ? 'negative' : 'positive'
  const axis = cycle.startsWith('x-') ? 'X' : cycle.startsWith('y-') ? 'Y' : null
  const horizontal = axis === 'X'
  const arrow = side === 'negative'
    ? horizontal ? 'M68 60 H39' : 'M60 68 V39'
    : horizontal ? 'M52 60 H81' : 'M60 52 V81'
  const edgeProbeX = horizontal ? (side === 'negative' ? 78 : 42) : 60
  const edgeProbeY = horizontal ? 60 : (side === 'negative' ? 78 : 42)
  const id = cycle.replace(/-/g, '')

  const TopProbe = ({ x = 60, y = 60 }: { x?: number; y?: number }) => <g>
    <circle cx={x} cy={y} r="10" fill={`url(#probeMetal${id})`} stroke="var(--text-muted)" strokeWidth="1.2" />
    <circle cx={x} cy={y} r="6.5" fill="var(--surface)" stroke="var(--border-strong)" />
    <circle cx={x} cy={y} r="2.7" fill="var(--accent)" />
    <path d={`M${x - 4} ${y - 4} L${x + 4} ${y + 4} M${x + 4} ${y - 4} L${x - 4} ${y + 4}`}
      stroke="var(--text-dim)" strokeWidth=".7" />
  </g>

  const Datum = ({ x, y, label }: { x: number; y: number; label: string }) => <g>
    <circle cx={x} cy={y} r="3.7" fill="var(--surface)" stroke="var(--ok)" strokeWidth="1.6" />
    <circle cx={x} cy={y} r="1.4" fill="var(--ok)" />
    <text x={x + 5} y={y - 4} fill="var(--ok)" fontSize="6.5" fontWeight="700">{label}</text>
  </g>

  const SequenceBadge = ({ x, y, value }: { x: number; y: number; value: number }) => <g>
    <circle cx={x} cy={y} r="6" fill="var(--surface)" stroke="var(--accent)" strokeWidth="1.2" />
    <text x={x} y={y + 2.5} textAnchor="middle" fill="var(--accent)" fontSize="7.5" fontWeight="800">{value}</text>
  </g>

  return (
    <svg viewBox="0 0 120 120" className="w-full h-full" role="img" aria-label={`${cycle} probing diagram`}>
      <defs>
        <marker id={`probe-arrow-${cycle}`} markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto">
          <path d="M0 0 L7 3.5 L0 7Z" fill="var(--accent)" />
        </marker>
        <marker id={`axis-x-${id}`} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
          <path d="M0 0 L5 2.5 L0 5Z" fill="#ef4444" />
        </marker>
        <marker id={`axis-y-${id}`} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
          <path d="M0 0 L5 2.5 L0 5Z" fill="#22c55e" />
        </marker>
        <marker id={`axis-z-${id}`} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
          <path d="M0 0 L5 2.5 L0 5Z" fill="#3b82f6" />
        </marker>
        <linearGradient id={`probeMetal${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--surface)" />
          <stop offset=".48" stopColor="var(--border-strong)" />
          <stop offset="1" stopColor="var(--elevated)" />
        </linearGradient>
        <linearGradient id={`probePart${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--elevated)" />
          <stop offset="1" stopColor="var(--border)" />
        </linearGradient>
        <pattern id={`probeHatch${id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill={`url(#probePart${id})`} />
          <path d="M0 0 V6" stroke="var(--border-strong)" strokeWidth="1" opacity=".45" />
        </pattern>
        <filter id={`probeShadow${id}`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000" floodOpacity=".22" />
        </filter>
      </defs>
      <rect x="1" y="1" width="118" height="118" rx="8" fill="rgb(var(--accent-rgb) / .035)" stroke="var(--border)" />
      {axis && !centerAxis && <>
        <path d="M12 108 H31" stroke="#ef4444" strokeWidth="1.2" markerEnd={`url(#axis-x-${id})`} />
        <path d="M12 108 V89" stroke="#22c55e" strokeWidth="1.2" markerEnd={`url(#axis-y-${id})`} />
        <text x="34" y="110" fill="var(--text-dim)" fontSize="6.5">X+</text>
        <text x="6" y="85" fill="var(--text-dim)" fontSize="6.5">Y+</text>
      </>}
      {isZ ? <>
        <path d="M13 84 H107 V104 H13Z" fill={`url(#probeHatch${id})`} stroke="var(--border-strong)" />
        <path d="M13 84 H107" stroke="var(--ok)" strokeWidth="2" />
        <path d="M20 84 L27 77 H100 L93 84Z" fill="rgb(var(--accent-rgb) / .14)" stroke="var(--accent)" strokeWidth="1" />
        <TopProbe x={60} y={35} />
        <path d="M60 45 V81" stroke="var(--accent)" strokeWidth="2.5" strokeDasharray="5 3" markerEnd={`url(#probe-arrow-${cycle})`} />
        <text x="66" y="62" fill="var(--accent)" fontSize="8" fontWeight="800">Z−</text>
        <Datum x={60} y={84} label="Z0" />
        <path d="M101 77 V84 M97 77 H105 M97 84 H105" stroke="var(--text-muted)" strokeWidth=".9" />
        <text x="84" y="73" fill="var(--text-muted)" fontSize="6.5" fontWeight="700">PLATE</text>
      </> : isBore || isRectangle ? <>
        {isBore ? <>
          <circle cx="60" cy="57" r="46" fill={`url(#probeHatch${id})`} stroke="var(--border-strong)" />
          <circle cx="60" cy="57" r="35" fill="var(--surface)" stroke="var(--text-muted)" strokeWidth="1.2" />
        </> : <>
          <rect x="10" y="13" width="100" height="88" rx="4" fill={`url(#probeHatch${id})`} stroke="var(--border-strong)" />
          <rect x="22" y="24" width="76" height="66" rx="3" fill="var(--surface)" stroke="var(--text-muted)" strokeWidth="1.2" />
        </>}
        <path d="M27 57 H49 M93 57 H71 M60 24 V46 M60 90 V68" stroke="var(--accent)" strokeWidth="2" strokeDasharray="3 2" />
        <path d="M49 57 L44 54 V60Z M71 57 L76 54 V60Z M60 46 L57 41 H63Z M60 68 L57 73 H63Z" fill="var(--accent)" />
        <circle cx="60" cy="57" r="15" fill="rgb(var(--accent-rgb) / .07)" stroke="var(--accent)" strokeDasharray="2 2" />
        <TopProbe x={60} y={57} />
        <path d="M48 57 H72 M60 45 V69" stroke="var(--ok)" strokeWidth=".8" />
        <SequenceBadge x={20} y={57} value={1} />
        <SequenceBadge x={100} y={57} value={2} />
        <SequenceBadge x={60} y={17} value={3} />
        <SequenceBadge x={60} y={97} value={4} />
      </> : centerAxis ? <>
        <rect x="10" y="13" width="100" height="88" rx="4" fill={`url(#probeHatch${id})`} stroke="var(--border-strong)" />
        <rect x="22" y="24" width="76" height="66" rx="3" fill="var(--surface)" stroke="var(--text-muted)" strokeWidth="1.2" />
        {centerAxis === 'X'
          ? <><path d="M27 57 H49 M93 57 H71" stroke="var(--accent)" strokeWidth="2" strokeDasharray="3 2" />
            <path d="M49 57 L44 54 V60Z M71 57 L76 54 V60Z" fill="var(--accent)" /></>
          : <><path d="M60 28 V46 M60 86 V68" stroke="var(--accent)" strokeWidth="2" strokeDasharray="3 2" />
            <path d="M60 46 L57 41 H63Z M60 68 L57 73 H63Z" fill="var(--accent)" /></>}
        <TopProbe x={60} y={57} />
        <path d={centerAxis === 'X' ? 'M44 57 H76 M60 49 V65' : 'M52 57 H68 M60 40 V74'} stroke="var(--ok)" strokeWidth=".8" />
        <SequenceBadge x={centerAxis === 'X' ? 29 : 72} y={centerAxis === 'X' ? 46 : 30} value={1} />
        <SequenceBadge x={centerAxis === 'X' ? 91 : 72} y={centerAxis === 'X' ? 46 : 84} value={2} />
      </> : <>
        <path d={horizontal
          ? side === 'negative' ? 'M17 18 H40 V102 H17Z' : 'M80 18 H103 V102 H80Z'
          : side === 'negative' ? 'M18 17 H102 V40 H18Z' : 'M18 80 H102 V103 H18Z'}
          fill={`url(#probeHatch${id})`} stroke="var(--border-strong)" />
        <path d={horizontal
          ? `M${side === 'negative' ? 40 : 80} 18 V102`
          : `M18 ${side === 'negative' ? 40 : 80} H102`} stroke="var(--ok)" strokeWidth="1.8" />
        <TopProbe x={edgeProbeX} y={edgeProbeY} />
        <path d={arrow} stroke="var(--accent)" strokeWidth="2.4" strokeDasharray="4 2" markerEnd={`url(#probe-arrow-${cycle})`} />
        <circle cx={horizontal ? (side === 'negative' ? 40 : 80) : 60} cy={horizontal ? 60 : (side === 'negative' ? 40 : 80)}
          r="3.2" fill="var(--surface)" stroke="var(--ok)" strokeWidth="1.5" />
        <text x={horizontal ? (side === 'negative' ? 20 : 85) : 69} y={horizontal ? 55 : (side === 'negative' ? 32 : 94)}
          fill="var(--ok)" fontSize="7" fontWeight="700">{axis}0</text>
        <text x={horizontal ? 54 : 72} y={horizontal ? 50 : (side === 'negative' ? 52 : 75)} fill="var(--accent)" fontSize="6.5" fontWeight="700">
          {axis}{side === 'negative' ? '−' : '+'}
        </text>
      </>}
    </svg>
  )
}

interface ParamRowProps {
  label: string; value: number; onChange: (v: number) => void; unit: string
  step?: number; min?: number; isTablet?: boolean
}

function ParamRow({ label, value, onChange, unit, step = 0.1, min = 0, isTablet }: ParamRowProps) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className={`text-text-muted font-semibold shrink-0 ${isTablet ? 'text-lg' : 'text-sm'}`}>{label}</span>
      <span className="flex items-center gap-1.5">
        <input type="number" value={value} onChange={e => onChange(Number(e.target.value))} step={step} min={min}
          className={`input-field font-mono text-right ${isTablet ? 'w-36 py-2 text-xl' : 'w-28 py-1 text-base'}`} />
        <span className={`text-text-dim shrink-0 ${isTablet ? 'text-base w-20' : 'text-xs w-14'}`}>{unit}</span>
      </span>
    </label>
  )
}

function toDisplayInput(value: number, units: 'mm' | 'in', decimals: number) {
  return Number(mmToDisplay(value, units).toFixed(decimals))
}

export function ProbePanel({ isTablet }: { isTablet?: boolean }) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = usePersisted<CycleId>('probe.cycle', 'z-surface')
  const [running, setRunning] = useState<RunningCycle | null>(null)
  const runningRef = useRef<RunningCycle | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [message, setMessage] = useState('Select a cycle and position the probe near the target surface.')
  const [probeFeed, setProbeFeed] = usePersisted('probe.feed', 100)
  const [maxTravel, setMaxTravel] = usePersisted('probe.travel', 50)
  const [retract, setRetract] = usePersisted('probe.retract', 3)
  const [plateThick, setPlateThick] = usePersisted('probe.plate', 0)
  const [probeDiameter, setProbeDiameter] = usePersisted('probe.diameter', 4)
  const status = useMachineStore(s => s.status)
  const units = useMachineStore(s => s.units)
  const connected = useMachineStore(s => s.connected)
  const canProbe = connected && status.state === 'Idle'

  function updateRun(next: RunningCycle | null) {
    runningRef.current = next
    setRunning(next)
  }

  function armTimeout() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      updateRun(null)
      setMessage('No probe contact report received. Check the probe and controller state.')
    }, 90_000)
  }

  function probe(axis: Axis, side: Side, distance = maxTravel) {
    sendRaw(`G21 G91 G38.2 F${number(probeFeed)} ${moveWord(axis, side, distance)}`)
    armTimeout()
  }

  function finish(messageText: string) {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = null
    updateRun(null)
    setMessage(messageText)
  }

  function finishAxisCenter(axis: Axis, first: number, second: number, continueWithY: boolean) {
    const midpoint = number((first + second) / 2)
    sendRaw(`G21 G91 G0 ${moveWord(axis, 'negative', retract)}`)
    sendRaw(`G90 G53 G0 ${axis}${midpoint}`)
    sendRaw(`G10 L20 P0 ${axis}0`)
    if (continueWithY) {
      const next = { id: runningRef.current!.id, phase: 'y-negative' }
      updateRun(next)
      setMessage('X center found. Probing Y−…')
      probe('Y', 'negative')
    } else {
      sendRaw('G90')
      finish(`${axis} center found and ${axis} work zero set.`)
    }
  }

  useEffect(() => onLine(line => {
    const point = parseProbePoint(line)
    const active = runningRef.current
    if (!point || !active) return
    const radius = probeDiameter / 2

    if (active.id === 'z-surface') {
      sendRaw(`G10 L20 P0 Z${number(plateThick)}`)
      sendRaw(`G21 G91 G0 Z${number(retract)}`)
      sendRaw('G90')
      finish('Z surface captured and work offset updated.')
      return
    }

    const edgeMatch = active.id.match(/^([xy])-(negative|positive)$/)
    if (edgeMatch) {
      const axis = edgeMatch[1].toUpperCase() as Axis
      const side = edgeMatch[2] as Side
      const compensatedCoordinate = side === 'negative' ? radius : -radius
      sendRaw(`G10 L20 P0 ${axis}${number(compensatedCoordinate)}`)
      sendRaw(`G21 G91 G0 ${moveWord(axis, side === 'negative' ? 'positive' : 'negative', retract)}`)
      sendRaw('G90')
      finish(`${axis}${side === 'negative' ? '−' : '+'} edge captured with probe-radius compensation.`)
      return
    }

    const axis = active.phase.startsWith('x-') ? 'X' : 'Y'
    if (active.phase.endsWith('negative')) {
      const first = axisValue(point, axis)
      sendRaw(`G21 G91 G0 ${moveWord(axis, 'positive', retract)}`)
      const next = { ...active, phase: `${axis.toLowerCase()}-positive`, first }
      updateRun(next)
      setMessage(`First ${axis} side captured. Probing ${axis}+…`)
      probe(axis, 'positive', maxTravel * 2)
      return
    }

    const second = axisValue(point, axis)
    const bothAxes = active.id === 'bore-center' || active.id === 'rectangle-center'
    finishAxisCenter(axis, active.first!, second, bothAxes && axis === 'X')
  }), [maxTravel, plateThick, probeDiameter, probeFeed, retract])

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current) }, [])

  function runProbe() {
    if (!canProbe || running || probeFeed <= 0 || maxTravel <= 0 || retract <= 0) return
    const edge = selected.match(/^([xy])-(negative|positive)$/)
    if (selected === 'z-surface') {
      updateRun({ id: selected, phase: 'z-negative' })
      setMessage('Probing Z− toward the work surface…')
      probe('Z', 'negative')
    } else if (edge) {
      const axis = edge[1].toUpperCase() as Axis
      const side = edge[2] as Side
      updateRun({ id: selected, phase: `${axis.toLowerCase()}-${side}` })
      setMessage(`Probing ${axis}${side === 'negative' ? '−' : '+'}…`)
      probe(axis, side)
    } else {
      const axis: Axis = selected === 'y-center' ? 'Y' : 'X'
      updateRun({ id: selected, phase: `${axis.toLowerCase()}-negative` })
      setMessage(`Probing first ${axis} side (${axis}−)…`)
      probe(axis, 'negative')
    }
  }

  function holdProbe() {
    sendRealtime(0x21)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    updateRun(null)
    setMessage('Feed hold requested. Resume or reset the controller before starting another cycle.')
  }

  const selectedCycle = CYCLES.find(c => c.id === selected)!
  const usesDiameter = selected !== 'z-surface'

  return (
    <div className="panel">
      <button className="panel-header w-full justify-between cursor-pointer hover:bg-elevated/50 transition-colors"
        onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <div className="flex items-center gap-2">
          <Target size={isTablet ? 20 : 15} />
          <span className="text-lg font-semibold">Probing</span>
          <span className="tag border-info/30 bg-info/10 text-info normal-case tracking-normal">{selectedCycle.label}</span>
        </div>
        <ChevronDown size={isTablet ? 20 : 15} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && <div className={`p-4 ${isTablet ? 'space-y-5' : 'space-y-4'}`}>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[.12em] text-text-dim mb-2">Single surface</div>
          <div className="grid grid-cols-5 gap-2">
            {CYCLES.filter(c => c.group === 'edge').map(c => <button key={c.id} onClick={() => setSelected(c.id)} disabled={!!running}
              className={`btn justify-center font-mono ${isTablet ? 'h-14 text-lg' : 'h-10 text-sm'} ${selected === c.id ? 'btn-primary' : 'btn-ghost'}`}>
              {c.short}
            </button>)}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[.12em] text-text-dim mb-2">Center finding</div>
          <div className="grid grid-cols-4 gap-2">
            {CYCLES.filter(c => c.group === 'center').map(c => <button key={c.id} onClick={() => setSelected(c.id)} disabled={!!running}
              className={`btn justify-center ${isTablet ? 'h-14 text-lg' : 'h-10 text-sm'} ${selected === c.id ? 'btn-primary' : 'btn-ghost'}`}>
              {c.label}
            </button>)}
          </div>
        </div>

        <div className={`grid gap-4 ${isTablet ? 'grid-cols-[220px_1fr]' : 'grid-cols-[150px_1fr]'}`}>
          <div className={`${isTablet ? 'h-[220px]' : 'h-[150px]'}`}><ProbeGraphic cycle={selected} /></div>
          <div className={`rounded-md border border-border bg-elevated/30 p-3 ${isTablet ? 'space-y-4' : 'space-y-2'}`}>
            <ParamRow isTablet={isTablet} label="Probe feed" value={toDisplayInput(probeFeed, units, units === 'in' ? 2 : 0)}
              onChange={v => setProbeFeed(displayToMm(v, units))} unit={feedUnitLabel(units)} step={units === 'in' ? .1 : 10} min={units === 'in' ? .1 : 1} />
            <ParamRow isTablet={isTablet} label="Max travel" value={toDisplayInput(maxTravel, units, units === 'in' ? 3 : 1)}
              onChange={v => setMaxTravel(displayToMm(v, units))} unit={linearUnitLabel(units)} step={units === 'in' ? .1 : 1} min={units === 'in' ? .1 : 1} />
            <ParamRow isTablet={isTablet} label="Retract" value={toDisplayInput(retract, units, units === 'in' ? 4 : 2)}
              onChange={v => setRetract(displayToMm(v, units))} unit={linearUnitLabel(units)} step={units === 'in' ? .01 : .5} min={units === 'in' ? .01 : .5} />
            {usesDiameter && <ParamRow isTablet={isTablet} label="Probe diameter" value={toDisplayInput(probeDiameter, units, units === 'in' ? 4 : 2)}
              onChange={v => setProbeDiameter(displayToMm(v, units))} unit={linearUnitLabel(units)} step={units === 'in' ? .001 : .01} min={0} />}
            {!usesDiameter && <ParamRow isTablet={isTablet} label="Plate thickness" value={toDisplayInput(plateThick, units, units === 'in' ? 4 : 2)}
              onChange={v => setPlateThick(displayToMm(v, units))} unit={linearUnitLabel(units)} step={units === 'in' ? .001 : .01} min={0} />}
          </div>
        </div>

        <div className={`flex items-center gap-3 rounded-md border px-3 py-2 ${running ? 'border-warn/40 bg-warn/5 text-warn' : 'border-border bg-elevated/20 text-text-muted'}`}>
          {running ? <CircleDot className="animate-pulse shrink-0" size={18} /> : <Crosshair className="shrink-0" size={18} />}
          <span className={`${isTablet ? 'text-lg' : 'text-sm'} flex-1`}>{message}</span>
        </div>

        <div className="flex gap-2">
          <button className={`btn flex-1 justify-center font-semibold gap-2 ${isTablet ? 'h-16 text-xl' : 'h-11 text-base'} ${canProbe && !running ? 'btn-warn' : 'btn-ghost'}`}
            onClick={runProbe} disabled={!canProbe || !!running}>
            <Target size={isTablet ? 22 : 17} />
            {running ? 'Cycle active' : canProbe ? `Run ${selectedCycle.label}` : connected ? 'Machine not Idle' : 'Controller offline'}
          </button>
          {running && <button className={`btn btn-danger justify-center gap-2 ${isTablet ? 'h-16 px-6 text-xl' : 'h-11 px-4'}`} onClick={holdProbe}>
            <OctagonX size={isTablet ? 22 : 17} /> Feed hold
          </button>}
        </div>
        {(selected === 'bore-center' || selected === 'rectangle-center') &&
          <p className="text-xs text-text-dim">Start with the probe inside the feature, near its center. The cycle touches X−/X+, centers X, then touches Y−/Y+ and sets X0 Y0.</p>}
      </div>}
    </div>
  )
}
