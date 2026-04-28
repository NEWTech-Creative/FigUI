import { useEffect, useState } from 'react'
import { ArrowRightToLine, Home, Power, TriangleAlert } from 'lucide-react'
import { useMachineStore, activePosition } from '../store'
import { sendRaw, sendRealtime } from '../lib/ws'
import { jogFeedKeyForAxis, loadPersistedJogFeed } from '../lib/jog'
import { droFeedUnitLabel, formatAxisCoord, formatFeedRate } from '../lib/units'

const ALARM_MESSAGES: Record<number, string> = {
  1: 'Hard limit triggered',
  2: 'Soft limit exceeded',
  3: 'Reset while in motion',
  4: 'Probe fail — initial state',
  5: 'Probe fail — no contact',
  6: 'Homing fail — reset',
  7: 'Homing fail — door open',
  8: 'Homing fail — pull-off',
  9: 'Homing fail — approach',
  10: 'Homing fail — dual axis',
  11: 'Spindle control fault',
  12: 'Control pin high at start',
  13: 'Homing required',
}

const AXES = ['X', 'Y', 'Z', 'A', 'B', 'C'] as const

const AXIS_COLOR: Record<string, string> = {
  X: 'var(--danger)',
  Y: 'var(--ok)',
  Z: 'var(--info)',
  A: 'var(--accent)',
  B: 'var(--purple)',
  C: 'var(--teal)',
}

type PendingAxisAction = {
  kind: 'go-to-zero' | 'home'
  axis: string
}

const MOTION_STATES = new Set(['Jog', 'Hold', 'Home'])

export function DRO() {
  const status = useMachineStore(s => s.status)
  const positionMode = useMachineStore(s => s.positionMode)
  const setPositionMode = useMachineStore(s => s.setPositionMode)
  const axes = useMachineStore(s => s.axes)
  const units = useMachineStore(s => s.units)
  const [pendingAxisAction, setPendingAxisAction] = useState<PendingAxisAction | null>(null)
  const [pendingAxisActionStarted, setPendingAxisActionStarted] = useState(false)
  const pos = activePosition(status, positionMode)

  const wCoords: Record<string, number> = {
    X: status.wpos.x, Y: status.wpos.y, Z: status.wpos.z,
    A: status.wpos.a ?? 0, B: status.wpos.b ?? 0, C: status.wpos.c ?? 0,
  }
  const mCoords: Record<string, number> = {
    X: status.mpos.x, Y: status.mpos.y, Z: status.mpos.z,
    A: status.mpos.a ?? 0, B: status.mpos.b ?? 0, C: status.mpos.c ?? 0,
  }
  const coordValues: Record<string, number> = {
    X: pos.x, Y: pos.y, Z: pos.z,
    A: pos.a ?? 0, B: pos.b ?? 0, C: pos.c ?? 0,
  }

  const visibleAxes = AXES.slice(0, axes)
  const isJobActive = status.state === 'Run' || status.state === 'Hold'
  const isPendingAxisActionInMotion = pendingAxisAction !== null && (pendingAxisActionStarted || status.state === 'Home')
  const shouldHideMotionControls = isJobActive && pendingAxisAction === null
  const areAxisButtonsDisabled = pendingAxisAction !== null

  // Auto-query alarm details when entering alarm state without a name
  useEffect(() => {
    if (status.state === 'Alarm' && !status.alarmName) {
      sendRaw('$A')
    }
  }, [status.state, status.alarmName])

  useEffect(() => {
    if (!pendingAxisAction) return

    if (!pendingAxisActionStarted) {
      if (MOTION_STATES.has(status.state)) {
        setPendingAxisActionStarted(true)
      }
      return
    }

    if (!MOTION_STATES.has(status.state)) {
      setPendingAxisAction(null)
      setPendingAxisActionStarted(false)
    }
  }, [pendingAxisAction, pendingAxisActionStarted, status.state])

  useEffect(() => {
    if (!pendingAxisAction || pendingAxisActionStarted) return

    const timeoutId = window.setTimeout(() => {
      setPendingAxisAction(current => current === pendingAxisAction ? null : current)
    }, 1500)

    return () => window.clearTimeout(timeoutId)
  }, [pendingAxisAction, pendingAxisActionStarted])


  function zeroAxis(axis: string) { sendRaw(`G10 L20 P0 ${axis}0`) }
  function zeroAll() { sendRaw(`G10 L20 P0 ${visibleAxes.map(a => `${a}0`).join(' ')}`) }
  function goToZero(axis: string) {
    const [feedKey, fallbackFeed] = jogFeedKeyForAxis(axis)
    const feed = loadPersistedJogFeed(feedKey, fallbackFeed)
    setPendingAxisAction({ kind: 'go-to-zero', axis })
    setPendingAxisActionStarted(false)
    sendRaw(`$J=G90 G21 F${feed} ${axis}0`)
  }
  function homeAxis(axis: string) {
    setPendingAxisAction({ kind: 'home', axis })
    setPendingAxisActionStarted(false)
    sendRaw(`$H${axis}`)
  }
  function homeAll() { sendRaw('$H') }
  function cancelPendingAxisAction() {
    if (pendingAxisAction?.kind === 'go-to-zero') {
      sendRealtime(0x85)
      return
    }
    sendRealtime(0x18)
  }

  return (
    <div className="panel flex flex-col">
      <div className="panel-header justify-between">
        <span>Position</span>
        <div className="flex items-center gap-0.5 bg-elevated rounded-sm border border-border p-0.5">
          {(['WPos', 'MPos', 'Both'] as const).map(m => (
            <button
              key={m}
              onClick={() => setPositionMode(m)}
              className={`px-2.5 py-0.5 text-xs rounded-sm transition-colors ${
                positionMode === m
                  ? 'bg-surface border border-border text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Axis rows – compact */}
      <div className="px-3 py-2 space-y-1">
        {positionMode === 'Both' && (
          <div className="flex items-center gap-2 pb-0.5">
            <span className="w-4 shrink-0" />
            <div className="flex-1 grid grid-cols-2 gap-2 text-[10px] font-mono text-text-muted uppercase tracking-widest">
              <span className="text-right">W</span>
              <span className="text-right">M</span>
            </div>
            {!shouldHideMotionControls && <div className="w-8 h-8 shrink-0 invisible" />}
            {!shouldHideMotionControls && (
              <div className="h-8 px-1.5 shrink-0 invisible flex items-center gap-0.5">
                <ArrowRightToLine size={11} />
                <span className="font-mono text-[11px]">0</span>
              </div>
            )}
            {!shouldHideMotionControls && <div className="w-8 h-8 shrink-0 invisible" />}
          </div>
        )}
        {visibleAxes.map(ax => (
          <div key={ax} className="flex items-center gap-2">
            <span
              className="text-sm font-black uppercase tracking-widest w-4 shrink-0 select-none"
              style={{ color: AXIS_COLOR[ax] ?? 'var(--text-muted)' }}
            >
              {ax}
            </span>
            {positionMode === 'Both' ? (
              <div className="flex-1 grid grid-cols-2 gap-2 min-w-0">
                <span
                  className="text-right font-mono tabular-nums tracking-tight text-[1.05rem] min-w-0 overflow-hidden"
                  style={{ fontWeight: 300, lineHeight: 1.2, color: 'var(--text-primary)' }}
                >
                  {formatAxisCoord(wCoords[ax], ax, units)}
                </span>
                <span
                  className="text-right font-mono tabular-nums tracking-tight text-[1.05rem] min-w-0 overflow-hidden"
                  style={{ fontWeight: 300, lineHeight: 1.2, color: 'var(--text-muted)' }}
                >
                  {formatAxisCoord(mCoords[ax], ax, units)}
                </span>
              </div>
            ) : (
            <span
              className="flex-1 text-right font-mono tabular-nums tracking-tight text-[1.75rem]"
              style={{ fontWeight: 300, lineHeight: 1.2, color: 'var(--text-primary)' }}
            >
              {formatAxisCoord(coordValues[ax], ax, units)}
            </span>
            )}
            {!shouldHideMotionControls && (
              <button
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-sm
                           border border-border text-text-muted text-xs font-bold
                           hover:text-accent hover:border-accent/50 hover:bg-accent/5
                           disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:text-text-muted disabled:hover:border-border disabled:hover:bg-transparent
                           transition-all duration-100"
                onClick={() => zeroAxis(ax)}
                title={`Zero ${ax}`}
                disabled={areAxisButtonsDisabled}
              >
                Z
              </button>
            )}
            {!shouldHideMotionControls && (
              <button
                className="shrink-0 h-8 px-1.5 flex items-center justify-center gap-0.5 rounded-sm
                           border border-border text-text-muted
                           hover:text-accent hover:border-accent/50 hover:bg-accent/5
                           disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:text-text-muted disabled:hover:border-border disabled:hover:bg-transparent
                           transition-all duration-100"
                onClick={() => goToZero(ax)}
                title={`Go to ${ax} zero`}
                disabled={areAxisButtonsDisabled}
              >
                <ArrowRightToLine size={11} />
                <span className="font-mono text-[11px]">0</span>
              </button>
            )}
            {!shouldHideMotionControls && (
              <button
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-sm
                           border border-border text-text-muted
                           disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:bg-transparent
                           hover:border-current hover:bg-current/5
                           transition-all duration-100"
                style={{ ['--tw-text-opacity' as string]: '1' } as React.CSSProperties}
                onClick={() => homeAxis(ax)}
                title={`Home ${ax}`}
                disabled={areAxisButtonsDisabled}
              >
                <Home size={13} style={{ color: AXIS_COLOR[ax] ?? 'var(--text-muted)' }} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="border-t border-border px-3 py-2 flex gap-2">
        {!shouldHideMotionControls && !isPendingAxisActionInMotion && (
          <button
            className="btn btn-warn flex-1 h-7 text-xs font-bold"
            onClick={zeroAll}
            title="Set current position as work zero for all axes"
            disabled={areAxisButtonsDisabled}
          >
            ⊙ Zero All
          </button>
        )}
        {!shouldHideMotionControls && !isPendingAxisActionInMotion && (
          <button
            className="btn btn-ghost flex-1 h-7 text-xs font-bold flex items-center justify-center gap-1.5"
            onClick={homeAll}
            title="Home all axes"
            disabled={areAxisButtonsDisabled}
          >
            <Home size={12} />
            Home All
          </button>
        )}
        {isPendingAxisActionInMotion && (
          <button
            className="btn btn-warn flex-1 h-7 text-xs font-bold"
            onClick={cancelPendingAxisAction}
            title={pendingAxisAction?.kind === 'home'
              ? 'Cancel homing (soft reset controller)'
              : 'Cancel axis move (jog cancel)'}
          >
            Cancel
          </button>
        )}
        {shouldHideMotionControls && (
          <button
            className="btn flex-1 h-7 text-xs font-bold flex items-center justify-center gap-1.5 bg-danger hover:bg-danger/85 text-white border-transparent"
            onClick={() => sendRealtime(0x18)}
            title="E-Stop — soft reset the controller"
          >
            <Power size={12} />
            E-Stop
          </button>
        )}
      </div>

      {status.state === 'Alarm' && (
        <div className="border-t-2 border-danger bg-danger/10 px-3 py-3 flex flex-col gap-2">
          <div className="flex items-start gap-2.5">
            <TriangleAlert size={20} className="text-danger mt-0.5 shrink-0" />
            <div className="flex flex-col gap-1 min-w-0">
              <span className="text-sm font-black text-danger uppercase tracking-widest leading-none">
                {status.alarmCode != null ? `Alarm ${status.alarmCode}` : 'Alarm'}
              </span>
              <span className="text-sm font-semibold text-text-primary leading-snug">
                {status.alarmName
                  ?? (status.alarmCode != null
                    ? (ALARM_MESSAGES[status.alarmCode] ?? `Unknown alarm code ${status.alarmCode}`)
                    : 'Machine is in alarm state')}
              </span>
            </div>
          </div>
          <button
            className="btn btn-danger w-full h-8 text-xs font-bold"
            onClick={() => sendRaw('$X')}
          >
            Clear Alarm
          </button>
        </div>
      )}

      {/* Feed / Spindle readout */}
      <div className="border-t border-border px-3 py-2 flex justify-between text-xs font-mono text-text-muted">
        <div className="flex items-center gap-1.5">
          <span>F</span>
          <span className="text-text-primary">{formatFeedRate(status.feed, units)}</span>
          <span className="text-text-dim text-[10px]">{droFeedUnitLabel(units)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>S</span>
          <span className="text-text-primary">{status.spindle}</span>
          <span className="text-text-dim text-[10px]">rpm</span>
        </div>
      </div>
    </div>
  )
}
