import { useState } from 'react'
import { Target, ChevronDown } from 'lucide-react'
import { sendRaw } from '../lib/ws'
import { useMachineStore } from '../store'
import { displayToMm, feedUnitLabel, linearUnitLabel, mmToDisplay } from '../lib/units'

function usePersisted<T>(key: string, init: T): [T, (v: T) => void] {
  const [val, setVal] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) return JSON.parse(raw) as T
    } catch {}
    return init
  })
  function persist(v: T) {
    localStorage.setItem(key, JSON.stringify(v))
    setVal(v)
  }
  return [val, persist]
}

interface ParamRowProps {
  label: string
  value: number
  onChange: (v: number) => void
  unit: string
  step?: number
  min?: number
  isTablet?: boolean
}

function ParamRow({ label, value, onChange, unit, step = 0.1, min = 0, isTablet }: ParamRowProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`text-text-muted font-semibold shrink-0 ${isTablet ? 'text-xl w-36' : 'text-lg w-24'}`}>{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          step={step}
          min={min}
          className={`input-field font-mono text-right ${isTablet ? 'w-36 py-2 text-xl' : 'w-36 py-1 text-xl'}`}
        />
        <span className={`text-text-dim shrink-0 ${isTablet ? 'text-lg w-20' : 'text-sm w-12'}`}>{unit}</span>
      </div>
    </div>
  )
}

function toDisplayInput(value: number, units: 'mm' | 'in', decimals: number) {
  const displayValue = mmToDisplay(value, units)
  return Number(displayValue.toFixed(decimals))
}

export function ProbePanel({ isTablet }: { isTablet?: boolean }) {
  const [open, setOpen] = useState(false)
  const [probing, setProbing] = useState(false)
  const [probeFeed, setProbeFeed] = usePersisted('probe.feed', 100)
  const [maxTravel, setMaxTravel] = usePersisted('probe.travel', 50)
  const [retract, setRetract]     = usePersisted('probe.retract', 3)
  const [plateThick, setPlateThick] = usePersisted('probe.plate', 0)

  const status = useMachineStore(s => s.status)
  const units = useMachineStore(s => s.units)
  const canProbe = status.state === 'Idle'

  function runProbe() {
    if (!canProbe || probing) return
    setProbing(true)
    // G38.2: probe toward workpiece, error on miss
    sendRaw(`G38.2 F${probeFeed} Z-${maxTravel}`)
    // Set Z work offset so Z=0 is at workpiece surface (below plate)
    sendRaw(`G10 L20 P0 Z${plateThick}`)
    // Retract
    sendRaw(`G91 G0 Z${retract}`)
    sendRaw('G90')
    // State returns to Idle once FluidNC executes the queue
    setTimeout(() => setProbing(false), 3000)
  }

  return (
    <div className="panel">
      <button
        className="panel-header w-full justify-between cursor-pointer hover:bg-elevated/50 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-2">
          <Target size={isTablet ? 20 : 13} />
          <span className={'text-lg font-semibold'}>Tool Probe</span>
        </div>
        <ChevronDown
          size={isTablet ? 20 : 13}
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className={`p-4 space-y-3 ${isTablet ? 'space-y-4' : ''}`}>
          <div className={`space-y-2 ${isTablet ? 'space-y-4' : ''}`}>
            <ParamRow
              isTablet={isTablet}
              label="Probe feed"
              value={toDisplayInput(probeFeed, units, units === 'in' ? 2 : 0)}
              onChange={value => setProbeFeed(displayToMm(value, units))}
              unit={feedUnitLabel(units)}
              step={units === 'in' ? 0.1 : 10}
              min={units === 'in' ? 0.1 : 1}
            />
            <ParamRow
              isTablet={isTablet}
              label="Max travel"
              value={toDisplayInput(maxTravel, units, units === 'in' ? 3 : 1)}
              onChange={value => setMaxTravel(displayToMm(value, units))}
              unit={linearUnitLabel(units)}
              step={units === 'in' ? 0.1 : 1}
              min={units === 'in' ? 0.1 : 1}
            />
            <ParamRow
              isTablet={isTablet}
              label="Retract"
              value={toDisplayInput(retract, units, units === 'in' ? 4 : 2)}
              onChange={value => setRetract(displayToMm(value, units))}
              unit={linearUnitLabel(units)}
              step={units === 'in' ? 0.01 : 0.5}
              min={units === 'in' ? 0.01 : 0.5}
            />
            <ParamRow
              isTablet={isTablet}
              label="Plate thick."
              value={toDisplayInput(plateThick, units, units === 'in' ? 4 : 2)}
              onChange={value => setPlateThick(displayToMm(value, units))}
              unit={linearUnitLabel(units)}
              step={units === 'in' ? 0.001 : 0.01}
            />
          </div>

          <button
            className={`btn w-full justify-center font-semibold gap-2
                        ${isTablet ? 'h-16 text-xl' : 'h-10 text-base'}
                        ${canProbe && !probing ? 'btn-warn' : 'btn-ghost'}`}
            onClick={runProbe}
            disabled={!canProbe || probing}
          >
            <Target size={isTablet ? 22 : 14} />
            {probing ? 'Probing…' : canProbe ? 'Probe Z' : 'Machine not Idle'}
          </button>

        </div>
      )}
    </div>
  )
}
