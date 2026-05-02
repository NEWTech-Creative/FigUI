import { create } from 'zustand'
import type {
  MachineStatus,
  MachineState,
  Position,
  ESPInfo,
  SidebarTab,
  PositionMode,
  JogStep,
  Macro,
  Units,
  LayoutMode,
  ControllerSettings,
} from './types'

export type Theme = 'light' | 'dark' | 'anthracite-dark' | 'midnight-dark'

const DARK_THEME_CLASSES = ['dark', 'anthracite-dark', 'midnight-dark'] as const

function isValidTheme(v: string | null): v is Theme {
  return v === 'light' || v === 'dark' || v === 'anthracite-dark' || v === 'midnight-dark'
}

function applyThemeClass(theme: Theme) {
  document.documentElement.classList.remove(...DARK_THEME_CLASSES)
  if (theme !== 'light') document.documentElement.classList.add(theme)
}

const _savedTheme = localStorage.getItem('theme')
const _initialTheme: Theme = isValidTheme(_savedTheme) ? _savedTheme : 'dark'
applyThemeClass(_initialTheme)


export interface WatchdogState {
  enabled: boolean
  monitoring: boolean
  alertLevel: 'none' | 'warning' | 'emergency'
  lastTrigger: number
  escalationStartTime: number
  inputState: {
    activeKeys: Set<string>
    mouseDown: boolean
    lastActivity: number
  }
  connectionHealth: {
    lastResponse: number
    missedPings: number
  }
}

function countDefinedAxes(pos: Position): number {
  if (pos.c !== undefined) return 6
  if (pos.b !== undefined) return 5
  if (pos.a !== undefined) return 4
  return 3
}

function subtractPos(a: Position, b: Position): Position {
  return {
    x: a.x - b.x, y: a.y - b.y, z: a.z - b.z,
    a: a.a != null && b.a != null ? a.a - b.a : a.a,
    b: a.b != null && b.b != null ? a.b - b.b : a.b,
    c: a.c != null && b.c != null ? a.c - b.c : a.c,
  }
}

function addPos(a: Position, b: Position): Position {
  return {
    x: a.x + b.x, y: a.y + b.y, z: a.z + b.z,
    a: a.a != null && b.a != null ? a.a + b.a : a.a,
    b: a.b != null && b.b != null ? a.b + b.b : a.b,
    c: a.c != null && b.c != null ? a.c + b.c : a.c,
  }
}

const DEFAULT_STATUS: MachineStatus = {
  state: 'Unknown',
  wpos: { x: 0, y: 0, z: 0 },
  mpos: { x: 0, y: 0, z: 0 },
  wco: { x: 0, y: 0, z: 0 },
  feed: 0,
  spindle: 0,
  spindleRunning: false,
  feedOverride: 100,
  rapidOverride: 100,
  spindleOverride: 100,
  pinState: '',
}

const DEFAULT_WATCHDOG_STATE: WatchdogState = {
  enabled: true,
  monitoring: false,
  alertLevel: 'none',
  lastTrigger: 0,
  escalationStartTime: 0,
  inputState: {
    activeKeys: new Set(),
    mouseDown: false,
    lastActivity: Date.now()
  },
  connectionHealth: {
    lastResponse: Date.now(),
    missedPings: 0
  }
}

// Macros are loaded from the controller at runtime (see Macros.tsx).
// We start empty; localStorage is no longer used for macros.

interface Store {
  connected: boolean
  restarting: boolean
  status: MachineStatus
  espInfo: ESPInfo | null
  controllerSettings: ControllerSettings
  theme: Theme
  units: Units
  layoutMode: LayoutMode
  positionMode: PositionMode
  sidebarTab: SidebarTab
  jogStep: JogStep
  axes: number
  macros: Macro[]
  watchdog: WatchdogState
  activeStepJog: {
    active: boolean
    startTime: number
    expectedDistance: number
    axis: string
  } | null

  setConnected: (v: boolean) => void
  setRestarting: (v: boolean) => void
  updateStatus: (s: Partial<MachineStatus>) => void
  setEspInfo: (info: ESPInfo) => void
  updateControllerSettings: (settings: Partial<ControllerSettings>) => void
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setUnits: (units: Units) => void
  setLayoutMode: (mode: LayoutMode) => void
  setPositionMode: (m: PositionMode) => void
  setSidebarTab: (t: SidebarTab) => void
  setJogStep: (s: JogStep) => void
  setAxes: (n: number) => void
  setMacros: (macros: Macro[]) => void
  setWatchdogState: (state: Partial<WatchdogState>) => void
  setActiveStepJog: (stepJog: Store['activeStepJog']) => void
  pendingUpdateVersion: string | null
  setPendingUpdateVersion: (v: string | null) => void
}

export const useMachineStore = create<Store>((set) => ({
  connected: false,
  restarting: false,
  status: DEFAULT_STATUS,
  espInfo: null,
  controllerSettings: {},
  theme: _initialTheme,
  units: localStorage.getItem('units') === 'in' ? 'in' : 'mm',
  layoutMode: ((): LayoutMode => {
    const v = localStorage.getItem('layoutMode')
    return v === 'tablet' || v === 'desktop' ? v : 'auto'
  })(),
  positionMode: 'WPos',
  sidebarTab: 'files',
  jogStep: 1,
  axes: 3,
  macros: [],
  watchdog: DEFAULT_WATCHDOG_STATE,
  activeStepJog: null,
  pendingUpdateVersion: null,

  setConnected: (connected) => set({ connected }),
  setRestarting: (restarting) => set({ restarting }),

  updateStatus: (s) =>
    set(state => {
      const merged = { ...state.status, ...s }
      const wco = merged.wco
      // Derive the missing position from the one reported + WCO
      if (s.mpos && !s.wpos) {
        merged.wpos = subtractPos(merged.mpos, wco)
      } else if (s.wpos && !s.mpos) {
        merged.mpos = addPos(merged.wpos, wco)
      }
      // Clear alarm name when leaving alarm state
      if (s.state && s.state !== 'Alarm') {
        merged.alarmName = undefined
      }
      // Auto-detect axis count from reported positions — only ever increases
      const detectedAxes = Math.max(
        state.axes,
        countDefinedAxes(merged.mpos),
        countDefinedAxes(merged.wpos),
      )
      return { status: merged, axes: detectedAxes }
    }),

  setEspInfo: (espInfo) =>
    set(state => ({ espInfo, axes: espInfo.axes || state.axes })),

  updateControllerSettings: (settings) =>
    set(state => ({
      controllerSettings: {
        ...state.controllerSettings,
        ...settings,
      },
    })),

  setTheme: (theme) =>
    set(() => {
      if (theme !== 'light') localStorage.setItem('darkTheme', theme)
      localStorage.setItem('theme', theme)
      applyThemeClass(theme)
      return { theme }
    }),

  toggleTheme: () =>
    set(state => {
      let theme: Theme
      if (state.theme === 'light') {
        const saved = localStorage.getItem('darkTheme')
        theme = isValidTheme(saved) && saved !== 'light' ? saved : 'dark'
      } else {
        localStorage.setItem('darkTheme', state.theme)
        theme = 'light'
      }
      localStorage.setItem('theme', theme)
      applyThemeClass(theme)
      return { theme }
    }),

  setUnits: (units) =>
    set(() => {
      localStorage.setItem('units', units)
      return { units }
    }),

  setLayoutMode: (layoutMode) =>
    set(() => {
      localStorage.setItem('layoutMode', layoutMode)
      return { layoutMode }
    }),

  setPositionMode: (positionMode) => set({ positionMode }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setJogStep: (jogStep) => set({ jogStep }),
  setAxes: (axes) => set({ axes }),

  setMacros: (macros) => set({ macros }),

  setWatchdogState: (state) =>
    set(prev => ({
      watchdog: {
        ...prev.watchdog,
        ...state,
        // Ensure inputState is properly merged if provided
        inputState: state.inputState ? { ...prev.watchdog.inputState, ...state.inputState } : prev.watchdog.inputState,
        // Ensure connectionHealth is properly merged if provided
        connectionHealth: state.connectionHealth ? { ...prev.watchdog.connectionHealth, ...state.connectionHealth } : prev.watchdog.connectionHealth
      }
    })),

  setActiveStepJog: (stepJog) => set({ activeStepJog: stepJog }),
  setPendingUpdateVersion: (pendingUpdateVersion) => set({ pendingUpdateVersion }),
}))

export const stateColor = (state: MachineState): string => {
  switch (state) {
    case 'Idle': return 'text-ok'
    case 'Run': return 'text-info'
    case 'Jog': return 'text-info'
    case 'Hold': return 'text-warn'
    case 'Home': return 'text-info'
    case 'Check': return 'text-warn'
    case 'Alarm': return 'text-danger'
    case 'Door': return 'text-danger'
    case 'Sleep': return 'text-text-muted'
    default: return 'text-text-muted'
  }
}

export const stateBg = (state: MachineState): string => {
  switch (state) {
    case 'Idle': return 'bg-ok/10 border-ok/30'
    case 'Run': return 'bg-info/10 border-info/30'
    case 'Jog': return 'bg-info/10 border-info/30'
    case 'Hold': return 'bg-warn/10 border-warn/30'
    case 'Home': return 'bg-info/10 border-info/30'
    case 'Alarm': return 'bg-danger/10 border-danger/30'
    case 'Door': return 'bg-danger/10 border-danger/30'
    default: return 'bg-elevated border-border'
  }
}

export const activePosition = (status: MachineStatus, mode: PositionMode): Position =>
  mode === 'MPos' ? status.mpos : status.wpos
