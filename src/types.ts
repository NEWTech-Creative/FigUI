export type MachineState =
  | 'Idle' | 'Run' | 'Hold' | 'Jog' | 'Alarm'
  | 'Door' | 'Check' | 'Home' | 'Sleep' | 'Unknown'

export interface Position {
  x: number
  y: number
  z: number
  a?: number
  b?: number
  c?: number
}

export interface MachineStatus {
  state: MachineState
  alarmCode?: number
  alarmName?: string
  wpos: Position
  mpos: Position
  wco: Position
  feed: number
  spindle: number
  spindleRunning?: boolean
  feedOverride: number
  rapidOverride: number
  spindleOverride: number
  pinState: string
  sdFilename?: string
  sdPercent?: number
}

export interface FileEntry {
  name: string
  size: number
  isDir: boolean
  shortname?: string
}

export interface FileListResult {
  files: FileEntry[]
  path: string
  total: number
  used: number
  occupation: number
}

export interface ESPInfo {
  version: string
  hostname: string
  authentication: boolean
  asyncMode: boolean
  wsPort: number
  wsIp: string
  axes: number
  primarySd: string
  secondarySd: string
}

export interface ControllerSettings {
  spindleMin?: number
  spindleMax?: number
  maxRateX?: number
  maxRateY?: number
  maxRateZ?: number
}

export interface Macro {
  id: string
  label: string
  command: string
  color: 'default' | 'accent' | 'ok' | 'warn' | 'danger' | 'info' | 'purple' | 'teal'
  filename?: string
  target?: 'SD' | 'ESP'
  glyph?: string
  pinned?: boolean
}

export type SidebarTab = 'files' | 'macros' | 'plugins'

export interface PluginManifest {
  name: string
  description?: string
  icon?: string
  version?: string
  entry?: string
  files?: string[]
  layout?: 'default' | 'fullview'
}

export interface Plugin {
  id: string
  manifest: PluginManifest
  entryUrl: string
  fs: 'sd' | 'local'
}

export interface StoreEntry {
  id: string
  name: string
  description?: string
  version?: string
  author?: string
  base: string
}
export type PositionMode = 'WPos' | 'MPos' | 'Both'
export type JogStep = 0.001 | 0.01 | 0.1 | 1 | 10 | 100
export type Units = 'mm' | 'in'
export type LayoutMode = 'auto' | 'tablet' | 'desktop'
