import { create } from 'zustand'
import { useMachineStore } from '../store'
import {
  isSocketOpen,
  onLine,
  onSoftReset,
  resumeResponseTraffic,
  sendStreamRaw,
  sendRealtime,
  suspendResponseTraffic,
} from '../lib/ws'

export type SenderPhase = 'idle' | 'streaming' | 'paused' | 'draining' | 'completed' | 'aborted' | 'error'

interface StreamBlock {
  command: string
  sourceLine: number
}

interface SenderState {
  phase: SenderPhase
  fileName: string | null
  acceptedLine: number | null
  totalSourceLines: number
  completedBlocks: number
  totalBlocks: number
  error: string | null
  start: (text: string, fileName: string) => boolean
  pause: () => void
  resume: () => void
  abort: () => void
  dismiss: () => void
}

let blocks: StreamBlock[] = []
let nextBlock = 0
let awaitingResponse = false
let ownsExclusiveTraffic = false
let completionTimer: ReturnType<typeof setTimeout> | null = null
let responseTimer: ReturnType<typeof setTimeout> | null = null
let resumePending = false

function stripComments(raw: string) {
  let result = ''
  let depth = 0
  for (const char of raw) {
    if (char === ';' && depth === 0) break
    if (char === '(') { depth++; continue }
    if (char === ')' && depth > 0) { depth--; continue }
    if (depth === 0) result += char
  }
  return result.trim()
}

export function buildStreamBlocks(text: string): { blocks: StreamBlock[]; totalSourceLines: number } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  const streamBlocks: StreamBlock[] = []
  lines.forEach((raw, index) => {
    const executable = stripComments(raw)
    if (!executable || executable === '%') return
    const command = raw.trim()
    streamBlocks.push({ command, sourceLine: index + 1 })
  })
  return { blocks: streamBlocks, totalSourceLines: Math.max(1, lines.length) }
}

function clearCompletionTimer() {
  if (completionTimer) clearTimeout(completionTimer)
  completionTimer = null
}

function clearResponseTimer() {
  if (responseTimer) clearTimeout(responseTimer)
  responseTimer = null
}

function releaseExclusiveTraffic() {
  if (!ownsExclusiveTraffic) return
  ownsExclusiveTraffic = false
  resumeResponseTraffic()
}

function finish(phase: 'completed' | 'aborted' | 'error', error: string | null = null) {
  clearCompletionTimer()
  clearResponseTimer()
  awaitingResponse = false
  resumePending = false
  releaseExclusiveTraffic()
  useGCodeSenderStore.setState({ phase, error })
}

function scheduleDrainCheck() {
  clearCompletionTimer()
  completionTimer = setTimeout(() => {
    const sender = useGCodeSenderStore.getState()
    const machine = useMachineStore.getState()
    if (sender.phase !== 'draining') return
    if (machine.status.state === 'Idle') finish('completed')
    else scheduleDrainCheck()
  }, 300)
}

function pump() {
  const state = useGCodeSenderStore.getState()
  if (state.phase !== 'streaming' || awaitingResponse) return
  if (!isSocketOpen()) {
    finish('error', 'Controller disconnected while streaming.')
    return
  }
  if (nextBlock >= blocks.length) {
    useGCodeSenderStore.setState({ phase: 'draining' })
    scheduleDrainCheck()
    return
  }

  const block = blocks[nextBlock]
  awaitingResponse = true
  if (!sendStreamRaw(block.command)) {
    finish('error', 'Controller disconnected while streaming.')
    return
  }
  clearResponseTimer()
  responseTimer = setTimeout(() => {
    if (!awaitingResponse || blocks[nextBlock] !== block) return
    sendRealtime(0x18)
    finish('error', `File line ${block.sourceLine}: controller did not acknowledge the G-code block.`)
  }, 30_000)
}

export const useGCodeSenderStore = create<SenderState>((set, get) => ({
  phase: 'idle',
  fileName: null,
  acceptedLine: null,
  totalSourceLines: 0,
  completedBlocks: 0,
  totalBlocks: 0,
  error: null,

  start: (text, fileName) => {
    const machine = useMachineStore.getState()
    if (!isSocketOpen() || !machine.connected || machine.status.state !== 'Idle') return false
    if (['streaming', 'paused', 'draining'].includes(get().phase)) return false

    const built = buildStreamBlocks(text)
    if (built.blocks.length === 0) {
      set({ phase: 'error', fileName, error: 'This file contains no executable G-code.' })
      return false
    }
    const oversized = built.blocks.find(block => new TextEncoder().encode(block.command).byteLength > 240)
    if (oversized) {
      set({
        phase: 'error',
        fileName,
        error: `File line ${oversized.sourceLine} exceeds the supported 240-byte controller line length.`,
      })
      return false
    }

    blocks = built.blocks
    nextBlock = 0
    awaitingResponse = false
    resumePending = false
    clearCompletionTimer()
    clearResponseTimer()
    suspendResponseTraffic()
    ownsExclusiveTraffic = true
    set({
      phase: 'streaming',
      fileName,
      acceptedLine: null,
      totalSourceLines: built.totalSourceLines,
      completedBlocks: 0,
      totalBlocks: built.blocks.length,
      error: null,
    })
    // Let any already-queued status/query response settle before the first block.
    setTimeout(pump, 50)
    return true
  },

  pause: () => {
    if (get().phase !== 'streaming' && get().phase !== 'draining') return
    sendRealtime(0x21)
    resumePending = false
    set({ phase: 'paused' })
  },

  resume: () => {
    if (get().phase !== 'paused') return
    sendRealtime(0x7e)
    resumePending = true
    const phase = nextBlock >= blocks.length && !awaitingResponse ? 'draining' : 'streaming'
    set({ phase })
    if (phase === 'streaming') pump()
    else scheduleDrainCheck()
  },

  abort: () => {
    if (!['streaming', 'paused', 'draining'].includes(get().phase)) return
    sendRealtime(0x18)
    finish('aborted')
  },

  dismiss: () => {
    if (['streaming', 'paused', 'draining'].includes(get().phase)) return
    set({ phase: 'idle', fileName: null, acceptedLine: null, error: null })
  },
}))

onLine(line => {
  if (!ownsExclusiveTraffic || !awaitingResponse) return
  if (line === 'ok') {
    clearResponseTimer()
    awaitingResponse = false
    const acknowledgedBlock = blocks[nextBlock]
    nextBlock++
    useGCodeSenderStore.setState({
      completedBlocks: nextBlock,
      acceptedLine: acknowledgedBlock?.sourceLine ?? null,
    })
    pump()
  } else if (line === 'error' || line.startsWith('error:') || line.startsWith('ALARM:') || line.includes('[MSG:ERR')) {
    const sourceLine = blocks[nextBlock]?.sourceLine
    // Do not let already-planned motion continue after a rejected program line.
    sendRealtime(0x18)
    finish('error', `${sourceLine ? `File line ${sourceLine}: ` : ''}${line}`)
  }
})

onSoftReset(() => {
  if (ownsExclusiveTraffic) finish('aborted')
})

useMachineStore.subscribe((state, previous) => {
  const sender = useGCodeSenderStore.getState()
  if (!['streaming', 'paused', 'draining'].includes(sender.phase)) return
  if (previous.connected && !state.connected) {
    finish('error', 'Controller disconnected while streaming.')
    return
  }
  if (state.status.state === 'Alarm') {
    finish('error', `Controller alarm${state.status.alarmCode ? ` ${state.status.alarmCode}` : ''}.`)
    return
  }
  if (state.status.state === 'Hold' && sender.phase !== 'paused' && !resumePending) {
    useGCodeSenderStore.setState({ phase: 'paused' })
  } else if (state.status.state === 'Run') {
    resumePending = false
    if (sender.phase === 'paused') {
      const phase = nextBlock >= blocks.length && !awaitingResponse ? 'draining' : 'streaming'
      useGCodeSenderStore.setState({ phase })
      if (phase === 'streaming') pump()
      else scheduleDrainCheck()
    }
  }
})
