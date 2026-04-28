import { useEffect, useRef, useState } from 'react'
import { useMachineStore } from './store'
import { useGCodeStore } from './store/gcode'
import { connect, sendRealtime, onConnectionHealth, isSocketOpen } from './lib/ws'
import { setBase, getDeviceInfo, getDeviceInfoFast } from './lib/http'
import { parseESP800 } from './lib/parser'
import { startWatchdog, stopWatchdog, updateConnectionHealth } from './lib/jogWatchdog'
import { Header } from './components/Header'
import { DRO } from './components/DRO'
import { JogPad } from './components/JogPad'
import { ProbePanel } from './components/ProbePanel'
import { GCodeViewer } from './components/GCodeViewer'
import { FileManager } from './components/FileManager'
import { Terminal } from './components/Terminal'
import { Macros } from './components/Macros'
import { SettingsPanel } from './components/SettingsPanel'
import { AboutModal } from './components/AboutModal'
import { JobControl } from './components/JobControl'
import { WifiOff, RefreshCw, Crosshair, Monitor, FolderOpen, TerminalSquare } from 'lucide-react'
import type { SidebarTab } from './types'

const SIDEBAR_TABS: { id: SidebarTab; label: string }[] = [
  { id: 'files',  label: 'Files'  },
  { id: 'macros', label: 'Macros' },
]

type MobilePanel = 'control' | 'viewer' | 'right' | 'terminal'
type TabletRightTab = 'viewer' | 'files' | 'macros' | 'terminal'

type Phase = 'connecting' | 'error' | 'ready'

export function App() {
  const { connected, restarting, sidebarTab, setSidebarTab, setEspInfo, setRestarting: setStoreRestarting, layoutMode } = useMachineStore()
  const machineState = useMachineStore(s => s.status.state)
  const loadGCodeFile = useGCodeStore(s => s.loadFile)
  const [phase, setPhase]   = useState<Phase>('connecting')
  const [errMsg, setErrMsg] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [mobilePanel, setMobilePanel]     = useState<MobilePanel>('control')
  const [tabletTab,   setTabletTab]       = useState<TabletRightTab>('viewer')

  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightPromise = useRef<Promise<boolean> | null>(null)
  const backoffMs = useRef(0)
  const cachedWsHost = useRef<string | null>(null)
  const cachedHostFailures = useRef(0)
  const [showReconnectOverlay, setShowReconnectOverlay] = useState(false)
  const restartSawDisconnect = useRef(false)

  async function resolveWsHost(httpHost: string): Promise<{ wsHost: string; info: ReturnType<typeof parseESP800> | null }> {
    if (cachedWsHost.current && cachedHostFailures.current < 3) {
      return { wsHost: cachedWsHost.current, info: null }
    }

    const raw  = cachedWsHost.current === null && cachedHostFailures.current > 0
      ? await getDeviceInfoFast()
      : await getDeviceInfo()
    const info = parseESP800(raw)
    const wsComm = info['webcommunication']?.trim() ?? ''
    const parts  = wsComm.split(':')
    const wsPort = parts[1]?.trim() ?? '80'
    const wsIp   = parts[2]?.trim() ?? httpHost.split(':')[0]
    const wsHost = wsPort === '80' ? wsIp : `${wsIp}:${wsPort}`
    cachedWsHost.current = wsHost
    cachedHostFailures.current = 0
    // Only refresh ESP info on a fresh probe.
    const axes = parseInt(info['axis'] ?? '3', 10)
    setEspInfo({
      version:        info['FW version']?.trim()     ?? '',
      hostname:       info['hostname']?.trim()        ?? httpHost,
      authentication: info['authentication']?.trim()  === 'yes',
      asyncMode:      parts[0]?.trim()               === 'Async',
      wsPort:         parseInt(wsPort, 10),
      wsIp,
      axes:           isNaN(axes) ? 3 : axes,
      primarySd:      info['primary sd']?.trim()     ?? '/sd/',
      secondarySd:    info['secondary sd']?.trim()   ?? '/ext/',
    })
    return { wsHost, info }
  }

  function attemptConnect(): Promise<boolean> {
    if (inFlightPromise.current) return inFlightPromise.current
    const p = (async () => {
      try {
        const httpHost = window.location.host
        setBase(`http://${httpHost}`)
        const { wsHost } = await resolveWsHost(httpHost)
        await connect(wsHost)
        backoffMs.current = 0
        cachedHostFailures.current = 0
        return true
      } catch (e) {
        cachedHostFailures.current++
        if (cachedHostFailures.current >= 3) cachedWsHost.current = null
        if (phase !== 'ready') {
          setErrMsg(e instanceof Error ? e.message : 'Connection failed')
        }
        return false
      } finally {
        inFlightPromise.current = null
      }
    })()
    inFlightPromise.current = p
    return p
  }

  function scheduleReconnect() {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    // Exponential backoff, cap @ 30s.
    const next = backoffMs.current === 0 ? 1000 : Math.min(backoffMs.current * 2, 30000)
    backoffMs.current = next
    reconnectTimer.current = setTimeout(async () => {
      reconnectTimer.current = null
      if (isSocketOpen()) return
      await attemptConnect()
      if (!isSocketOpen()) scheduleReconnect()
    }, next)
  }

  // Initial connect (runs once).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const ok = await attemptConnect()
      if (cancelled) return
      if (ok || isSocketOpen()) {
        setPhase('ready')
      } else {
        setPhase('error')
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (phase !== 'ready') return
    if (connected) {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
        reconnectTimer.current = null
      }
      backoffMs.current = 0
    } else if (!reconnectTimer.current) {
      reconnectTimer.current = setTimeout(async () => {
        reconnectTimer.current = null
        if (isSocketOpen()) return
        await attemptConnect()
        if (!isSocketOpen()) scheduleReconnect()
      }, 300)
    }
  }, [connected, phase])

  useEffect(() => {
    if (!restarting) {
      restartSawDisconnect.current = false
      return
    }
    if (!connected) {
      restartSawDisconnect.current = true
    } else if (restartSawDisconnect.current) {
      restartSawDisconnect.current = false
      setStoreRestarting(false)
    }
  }, [restarting, connected, setStoreRestarting])

  useEffect(() => {
    if (!restarting) return
    const t = setTimeout(() => setStoreRestarting(false), 60_000)
    return () => clearTimeout(t)
  }, [restarting, setStoreRestarting])

  // Debounce the "Reconnecting…" overlay so transient drops don't flash it.
  useEffect(() => {
    if (phase !== 'ready') {
      setShowReconnectOverlay(false)
      return
    }
    if (connected) {
      setShowReconnectOverlay(false)
      return
    }
    const t = setTimeout(() => setShowReconnectOverlay(true), 1500)
    return () => clearTimeout(t)
  }, [connected, phase])

  // Manual retry from the error screen.
  async function retryFromError() {
    setPhase('connecting')
    setErrMsg('')
    backoffMs.current = 0
    cachedWsHost.current = null
    cachedHostFailures.current = 0
    const ok = await attemptConnect()
    setPhase(ok ? 'ready' : 'error')
  }

  useEffect(() => {
    if (!connected) return
    const id = setInterval(() => sendRealtime(0x3F), 500)
    return () => clearInterval(id)
  }, [connected])

  useEffect(() => {
    if (!connected) {
      stopWatchdog()
      return
    }

    startWatchdog()

    const unsubscribeHealth = onConnectionHealth((health) => {
      updateConnectionHealth(health.lastResponseTime, health.missedPings)
    })

    return () => {
      unsubscribeHealth()
    }
  }, [connected])

  useEffect(() => {
    if (!settingsOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSettingsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen])

  // On mobile/tablet, switch to the viewer when a file is selected; also kick off
  // the single shared download via the gcode store.
  useEffect(() => {
    function onGcodeLoad(e: Event) {
      if (machineState === 'Run' || machineState === 'Hold') return
      const path = (e as CustomEvent<string>).detail
      loadGCodeFile(path)
      setMobilePanel('viewer')
      setTabletTab('viewer')
    }
    window.addEventListener('gcode:load', onGcodeLoad as EventListener)
    return () => window.removeEventListener('gcode:load', onGcodeLoad as EventListener)
  }, [loadGCodeFile, machineState])

  if (phase === 'connecting') {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-[var(--bg)]">
        <RefreshCw size={28} className="text-accent animate-spin" />
        <span className="text-text-muted text-sm">Connecting to FluidNC…</span>
        <span className="text-text-dim text-xs font-mono">{window.location.host}</span>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-[var(--bg)]">
        <WifiOff size={28} className="text-danger" />
        <span className="text-text-primary text-sm font-medium">Could not connect</span>
        <span className="text-danger text-xs max-w-xs text-center">{errMsg}</span>
        <span className="text-text-dim text-xs font-mono">{window.location.host}</span>
        <button className="btn-primary mt-2" onClick={retryFromError}>
          Retry
        </button>
      </div>
    )
  }

  const sidebarTabBar = (
    <div className="flex border-b border-border shrink-0">
      {SIDEBAR_TABS.map(tab => (
        <button
          key={tab.id}
          onClick={() => setSidebarTab(tab.id)}
          className={`flex-1 py-2.5 text-sm font-medium uppercase tracking-wide
                      transition-colors border-b-2 -mb-px ${
            sidebarTab === tab.id
              ? 'border-accent text-accent'
              : 'border-transparent text-text-muted'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )

  return (
    <div className="flex flex-col min-h-[100svh] md:h-full md:overflow-hidden bg-[var(--bg)] relative">
      {restarting ? (
        <div className="fixed md:absolute inset-0 z-50 bg-[var(--bg)]/80 backdrop-blur-sm
                        flex flex-col items-center justify-center gap-3">
          <RefreshCw size={24} className="text-accent animate-spin" />
          <span className="text-text-primary text-sm font-medium">Restarting controller…</span>
          <span className="text-text-muted text-xs">Waiting for FluidNC to come back online</span>
        </div>
      ) : showReconnectOverlay && (
        <div className="fixed md:absolute inset-0 z-50 bg-[var(--bg)]/80 backdrop-blur-sm
                        flex flex-col items-center justify-center gap-3">
          <RefreshCw size={24} className="text-accent animate-spin" />
          <span className="text-text-muted text-sm">Reconnecting…</span>
        </div>
      )}

      <Header
        onSettingsClick={() => setSettingsOpen(true)}
        onAboutClick={() => setAboutOpen(true)}
      />


      <div className="md:hidden flex flex-col">
        {mobilePanel === 'control' && (
          <div className="flex flex-col gap-3 p-3 pb-20">
            <DRO />
            <JobControl />
            <JogPad />
            <ProbePanel />
          </div>
        )}

        <div className={`h-[calc(100dvh-3rem)] flex flex-col gap-3 p-3 pb-[4.5rem] overflow-hidden ${mobilePanel !== 'viewer' ? 'hidden' : ''}`}>
          <GCodeViewer className="flex-1 min-h-0" />
        </div>

        {mobilePanel === 'right' && (
          <div className="h-[calc(100dvh-3rem)] flex flex-col gap-3 p-3 pb-[4.5rem] overflow-hidden">
            <div className="panel flex flex-col flex-1 min-h-0 overflow-hidden">
              {sidebarTabBar}
              <div className="flex-1 min-h-0 overflow-hidden">
                {sidebarTab === 'files'  && <FileManager />}
                {sidebarTab === 'macros' && <Macros />}
              </div>
            </div>
          </div>
        )}

        {mobilePanel === 'terminal' && (
          <div className="h-[calc(100dvh-3rem)] flex flex-col p-3 pb-[4.5rem] overflow-hidden">
            <div className="panel flex flex-col flex-1 min-h-0 overflow-hidden">
              <Terminal />
            </div>
          </div>
        )}
      </div>

      {/* ── Mobile bottom nav ───────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-surface border-t border-border flex items-stretch">
        {([
          { id: 'control'  as MobilePanel, Icon: Crosshair,    label: 'Control' },
          { id: 'viewer'   as MobilePanel, Icon: Monitor,      label: 'Viewer'  },
          { id: 'right'    as MobilePanel, Icon: FolderOpen,   label: 'Files'   },
          { id: 'terminal' as MobilePanel, Icon: TerminalSquare, label: 'Term'  },
        ] as const).map(({ id, Icon, label }) => (
          <button
            key={id}
            onClick={() => setMobilePanel(id)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium
                        transition-colors ${
              mobilePanel === id ? 'text-accent' : 'text-text-muted'
            }`}
          >
            <Icon size={20} />
            {label}
          </button>
        ))}
      </nav>


      <div className={`flex-1 min-h-0 grid-cols-[340px_1fr] gap-3 p-3 overflow-hidden ${
        layoutMode === 'tablet'  ? 'hidden md:grid'
        : layoutMode === 'desktop' ? 'hidden'
        : 'hidden md:grid xl:hidden'
      }`}>

        {/* Left: DRO + JogPad */}
        <div className="flex flex-col gap-3 min-h-0 overflow-y-auto">
          <DRO />
          <JogPad />
        </div>

        {/* Right: expanded tab panel */}
        <div className="panel flex flex-col min-h-0 overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-border shrink-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {([
              { id: 'viewer'   as TabletRightTab, label: 'Viewer'   },
              { id: 'files'    as TabletRightTab, label: 'Files'    },
              { id: 'macros'   as TabletRightTab, label: 'Macros'   },
              { id: 'terminal' as TabletRightTab, label: 'Terminal' },
            ] as const).map(tab => (
              <button
                key={tab.id}
                onClick={() => setTabletTab(tab.id)}
                className={`px-5 py-2.5 text-sm font-medium uppercase tracking-wide whitespace-nowrap
                            transition-colors border-b-2 -mb-px ${
                  tabletTab === tab.id
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-muted hover:text-text-primary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <div className={`h-full flex flex-col gap-3 p-3 overflow-y-auto ${tabletTab !== 'viewer' ? 'hidden' : ''}`}>
              <GCodeViewer className="flex-1 min-h-[300px]" />
              <ProbePanel />
            </div>
            {tabletTab === 'files'    && <FileManager />}
            {tabletTab === 'macros'   && <Macros />}
            {tabletTab === 'terminal' && <Terminal />}
          </div>
        </div>

      </div>


      <div className={`flex-1 min-h-0 grid-cols-[380px_1fr_340px] gap-3 p-3 overflow-hidden ${
        layoutMode === 'desktop' ? 'hidden md:grid'
        : layoutMode === 'tablet'  ? 'hidden'
        : 'hidden xl:grid'
      }`}>

        {/* Left: DRO + jog controls */}
        <div className="flex flex-col gap-3 min-h-0 overflow-y-auto">
          <DRO />
          <JogPad />
        </div>

        {/* Center: G-code viewer + probe */}
        <div className="min-h-0 flex flex-col gap-3 overflow-y-auto">
          <GCodeViewer className="flex-1 min-h-[300px]" />
          <ProbePanel />
        </div>

        {/* Right: tabbed panel + terminal */}
        <div className="flex flex-col min-h-0 gap-3 overflow-hidden">
          <div className="panel flex flex-col min-h-0 flex-1 overflow-hidden">
            {sidebarTabBar}
            <div className="flex-1 min-h-0 overflow-hidden">
              {sidebarTab === 'files'  && <FileManager />}
              {sidebarTab === 'macros' && <Macros />}
            </div>
          </div>

          <div className="panel flex flex-col min-h-[200px] flex-1 overflow-hidden">
            <Terminal />
          </div>
        </div>

      </div>

      {/* ── Settings Modal ── */}
      {settingsOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4"
          onClick={e => { if (e.target === e.currentTarget) setSettingsOpen(false) }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative w-full sm:max-w-3xl
                          h-[92dvh] sm:h-[min(85vh,720px)]
                          bg-surface border-t sm:border border-border
                          rounded-t-2xl sm:rounded-lg
                          shadow-2xl flex flex-col overflow-hidden animate-in">
            <SettingsPanel onClose={() => setSettingsOpen(false)} />
          </div>
        </div>
      )}

      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
    </div>
  )
}
