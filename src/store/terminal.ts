import { create } from 'zustand'
import { onLine } from '../lib/ws'
import { classifyLine } from '../lib/parser'

const MAX_LINES = 1000
const MAX_HISTORY = 100

export type LineKind = ReturnType<typeof classifyLine>

export interface LogLine {
  id: number
  text: string
  kind: LineKind
}

interface TerminalStore {
  lines: LogLine[]
  history: string[]
  verbose: boolean
  autoScroll: boolean
  setVerbose: (v: boolean) => void
  setAutoScroll: (v: boolean) => void
  pushHistory: (cmd: string) => void
  appendLine: (text: string) => void
  clear: () => void
}

let lineId = 0

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  lines: [],
  history: [],
  verbose: false,
  autoScroll: true,

  setVerbose: (verbose) => set({ verbose }),
  setAutoScroll: (autoScroll) => set({ autoScroll }),

  pushHistory: (cmd) =>
    set(state => ({ history: [cmd, ...state.history.slice(0, MAX_HISTORY - 1)] })),

  appendLine: (text) => {
    const kind = classifyLine(text)
    if (!get().verbose && (kind === 'status' || kind === 'ok')) return
    set(state => {
      const next = state.lines.length >= MAX_LINES
        ? [...state.lines.slice(-(MAX_LINES - 1)), { id: lineId++, text, kind }]
        : [...state.lines, { id: lineId++, text, kind }]
      return { lines: next }
    })
  },

  clear: () => set({ lines: [] }),
}))

onLine((line) => useTerminalStore.getState().appendLine(line))
