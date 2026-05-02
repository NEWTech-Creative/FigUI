import { parseControllerSettingLine, parseGcStateLine, parseStatusReport } from './parser'
import { useMachineStore } from '../store'

let socket: WebSocket | null = null

let generation = 0

let pingTimer: ReturnType<typeof setInterval> | null = null
let livenessTimer: ReturnType<typeof setInterval> | null = null
let statusPollTimer: ReturnType<typeof setInterval> | null = null
let pendingPingOks = 0

interface SilentResponseMatcher {
  starts: (line: string) => boolean
  consume: (line: string) => boolean
  done: (line: string) => boolean
}

const SETTINGS_DUMP_SILENT_RESPONSE: SilentResponseMatcher = {
  starts: (line) => /^\$\d+=/.test(line),
  consume: (line) => /^\$\d+=/.test(line),
  done: (line) => line === 'ok' || line === 'error',
}

const ALARM_QUERY_SILENT_RESPONSE: SilentResponseMatcher = {
  starts: (line) => /^\d+:\s/.test(line) || /^Active alarm:\s*\d+\s*\([^)]+\)/.test(line),
  consume: (line) => /^\d+:\s/.test(line) || /^Active alarm:\s*\d+\s*\([^)]+\)/.test(line),
  done: (line) => line === 'ok' || line === 'error',
}

function loadStablePageId(): string {
  try {
    const existing = sessionStorage.getItem('fluidui_pageid')
    if (existing && /^\d{4,}$/.test(existing)) return existing
    const fresh = String(Math.floor(Math.random() * 9000) + 1000)
    sessionStorage.setItem('fluidui_pageid', fresh)
    return fresh
  } catch {
    return String(Math.floor(Math.random() * 9000) + 1000)
  }
}
let pageId = loadStablePageId()

interface ConnectionHealth {
  lastPingTime: number
  lastResponseTime: number
  missedPings: number
}

let connectionHealth: ConnectionHealth = {
  lastPingTime: 0,
  lastResponseTime: Date.now(),
  missedPings: 0,
}

type ConnectionHealthCallback = (health: ConnectionHealth) => void
const connectionCallbacks = new Set<ConnectionHealthCallback>()

export function onConnectionHealth(callback: ConnectionHealthCallback): () => void {
  connectionCallbacks.add(callback)
  return () => { connectionCallbacks.delete(callback) }
}

function updateConnectionHealth() {
  connectionCallbacks.forEach(cb => cb({ ...connectionHealth }))
}


interface QueuedCommand {
  command: string
  isRealtime: boolean
  priority: 'normal' | 'high' | 'emergency'
  timestamp: number
  silentResponseMatcher?: SilentResponseMatcher
  acknowledgmentCallback?: () => void
  timeoutMs?: number
}

const commandQueue: QueuedCommand[] = []
let commandProcessor: ReturnType<typeof setInterval> | null = null
const pendingAcknowledgments = new Map<string, { callback: () => void, timeoutId: ReturnType<typeof setTimeout> }>()
const pendingSilentResponses: SilentResponseMatcher[] = []
let activeSilentResponse: SilentResponseMatcher | null = null

function startCommandProcessor() {
  if (commandProcessor) return
  commandProcessor = setInterval(processCommandQueue, 10)
}

function stopCommandProcessor() {
  if (commandProcessor) {
    clearInterval(commandProcessor)
    commandProcessor = null
  }
}

function processCommandQueue() {
  if (commandQueue.length === 0 || socket?.readyState !== WebSocket.OPEN) return

  commandQueue.sort((a, b) => {
    const order = { emergency: 0, high: 1, normal: 2 }
    const diff = order[a.priority] - order[b.priority]
    return diff !== 0 ? diff : a.timestamp - b.timestamp
  })

  const command = commandQueue.shift()
  if (!command) return

  try {
    if (command.isRealtime) {
      const buf = new Uint8Array(1)
      buf[0] = parseInt(command.command)
      socket!.send(buf)
    } else {
      socket!.send(new TextEncoder().encode(command.command + '\n'))
    }
  } catch {
    // Socket transitioned mid-send — drop quietly; reconnect handles it.
    return
  }

  if (command.silentResponseMatcher) {
    pendingSilentResponses.push(command.silentResponseMatcher)
  }

  if (command.acknowledgmentCallback) {
    const ackKey = `${command.command}_${command.timestamp}`
    const timeoutId = setTimeout(() => {
      pendingAcknowledgments.delete(ackKey)
    }, command.timeoutMs || 5000)
    pendingAcknowledgments.set(ackKey, { callback: command.acknowledgmentCallback, timeoutId })
  }
}

function queueCommand(command: QueuedCommand) {
  commandQueue.push(command)
}

type LineHandler = (line: string) => void
const lineHandlers = new Set<LineHandler>()

export const getPageId = () => pageId

export function onLine(fn: LineHandler): () => void {
  lineHandlers.add(fn)
  return () => { lineHandlers.delete(fn) }
}

const PING_INTERVAL_MS = 5000
const LIVENESS_CHECK_MS = 2000
const LIVENESS_TIMEOUT_MS = 12000
const OPEN_TIMEOUT_MS = 6000
const STATUS_POLL_INTERVAL_MS = 500
// 0x3F = '?' — FluidNC's real-time status request byte.
const STATUS_REPORT_BYTE = 0x3F

export function connect(host: string): Promise<void> {
  return new Promise((resolve, reject) => {

    closeCurrentSocket()
    generation++
    const myGen = generation

    let ws: WebSocket
    try {
      ws = new WebSocket(`ws://${host}/`, 'arduino')
    } catch (e) {
      reject(e instanceof Error ? e : new Error('WebSocket constructor failed'))
      return
    }
    ws.binaryType = 'arraybuffer'
    socket = ws

    let settled = false
    const openTimeout = setTimeout(() => {
      if (settled) return
      settled = true
      // Mark generation stale so any late onopen/onerror is ignored.
      if (socket === ws) {
        try { ws.close() } catch { /* noop */ }
      }
      reject(new Error('WebSocket connection timed out'))
    }, OPEN_TIMEOUT_MS)

    ws.onopen = () => {
      if (myGen !== generation || settled) return
      settled = true
      clearTimeout(openTimeout)

      connectionHealth.lastResponseTime = Date.now()
      connectionHealth.missedPings = 0
      updateConnectionHealth()

      useMachineStore.getState().setConnected(true)
      startCommandProcessor()
      startPing()
      startLivenessWatchdog()
      startStatusPoll()

      // Replay startup log on (re)connect — version, WiFi status, warnings.
      sendRaw('$SS')
      // Refresh controller settings used by jog and spindle controls.
      sendSilentRaw('$$', SETTINGS_DUMP_SILENT_RESPONSE)

      resolve()
    }

    ws.onclose = () => {
      if (myGen !== generation) return
      handleDisconnect()
      if (!settled) {
        settled = true
        clearTimeout(openTimeout)
        reject(new Error('WebSocket closed before opening'))
      }
    }

    ws.onerror = () => {
      if (myGen !== generation) return
      // Don't tear down here — onclose will follow and do the cleanup.
      if (!settled) {
        settled = true
        clearTimeout(openTimeout)
        try { ws.close() } catch { /* noop */ }
        reject(new Error(`WebSocket error connecting to ws://${host}/`))
      }
    }

    ws.onmessage = (ev) => {
      if (myGen !== generation) return
      const text =
        ev.data instanceof ArrayBuffer
          ? new TextDecoder().decode(ev.data)
          : String(ev.data)
      text.split('\n').forEach(raw => {
        const line = raw.trim()
        if (line) handleLine(line)
      })
    }
  })
}

function handleDisconnect() {
  stopPing()
  stopLivenessWatchdog()
  stopStatusPoll()
  stopCommandProcessor()
  // Drop pending acks — they'll never resolve now.
  pendingAcknowledgments.forEach(({ timeoutId }) => clearTimeout(timeoutId))
  pendingAcknowledgments.clear()
  pendingSilentResponses.length = 0
  activeSilentResponse = null
  pendingPingOks = 0
  // Drop queued commands — sending them on a future reconnect would be
  // surprising (e.g. queued jog moves shouldn't auto-resume).
  commandQueue.length = 0
  if (useMachineStore.getState().connected) {
    useMachineStore.getState().setConnected(false)
  }
}

function closeCurrentSocket() {
  const stale = socket
  if (!stale) return
  // Detach all handlers so the close event can't double-fire downstream.
  stale.onopen = null
  stale.onclose = null
  stale.onerror = null
  stale.onmessage = null
  socket = null
  try { stale.close() } catch { /* noop */ }
  // No need to call handleDisconnect() — generation bump prevents stale
  // events, and the caller (connect or disconnect) owns post-close cleanup.
}

function startPing() {
  stopPing()
  pingTimer = setInterval(() => {
    if (socket?.readyState !== WebSocket.OPEN) return
    if (pendingAcknowledgments.size === 0) pendingPingOks++
    connectionHealth.lastPingTime = Date.now()
    try {
      socket.send(`PING:${pageId}\n`)
    } catch {
      // Send failed — let the liveness watchdog catch it.
    }
  }, PING_INTERVAL_MS)
}

function stopPing() {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
}

function startStatusPoll() {
  stopStatusPoll()
  statusPollTimer = setInterval(() => {
    if (socket?.readyState !== WebSocket.OPEN) return
    try {
      const buf = new Uint8Array(1)
      buf[0] = STATUS_REPORT_BYTE
      socket.send(buf)
    } catch {
      // Liveness watchdog will catch a dead socket.
    }
  }, STATUS_POLL_INTERVAL_MS)
}

function stopStatusPoll() {
  if (statusPollTimer) { clearInterval(statusPollTimer); statusPollTimer = null }
}

function startLivenessWatchdog() {
  stopLivenessWatchdog()
  livenessTimer = setInterval(() => {
    if (!socket) return
    const ws = socket
    if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
      // Browser hasn't fired onclose for some reason — force the cleanup.
      handleDisconnect()
      return
    }
    if (ws.readyState !== WebSocket.OPEN) return
    const silentFor = Date.now() - connectionHealth.lastResponseTime
    if (silentFor > LIVENESS_TIMEOUT_MS) {
      // Connection is dead — terminate so the App-level reconnect kicks in.
      // Bump generation first so the impending onclose is ignored as stale,
      // then run the cleanup ourselves.
      generation++
      try { ws.close() } catch { /* noop */ }
      socket = null
      handleDisconnect()
    }
  }, LIVENESS_CHECK_MS)
}

function stopLivenessWatchdog() {
  if (livenessTimer) { clearInterval(livenessTimer); livenessTimer = null }
}

function consumeSilentLine(line: string): boolean {
  if (!activeSilentResponse && pendingSilentResponses.length > 0) {
    const nextSilentResponse = pendingSilentResponses[0]
    if (nextSilentResponse.starts(line)) {
      activeSilentResponse = nextSilentResponse
    }
  }

  if (!activeSilentResponse) return false

  const shouldConsume = activeSilentResponse.consume(line)
  const isDone = activeSilentResponse.done(line)

  if (isDone) {
    pendingSilentResponses.shift()
    activeSilentResponse = null
  }

  return shouldConsume || isDone
}

// ──────────────────────────────────────────────────────────────────────────
// Inbound line handling
// ──────────────────────────────────────────────────────────────────────────

function handleLine(line: string) {
  connectionHealth.lastResponseTime = Date.now()
  if (connectionHealth.missedPings !== 0) {
    connectionHealth.missedPings = 0
  }
  updateConnectionHealth()

  if (line.startsWith('currentID:')) { pageId = line.slice(10); persistPageId(); return }
  if (line.startsWith('CURRENT_ID:')) { pageId = line.slice(11); persistPageId(); return }
  if (line.startsWith('activeID:') || line.startsWith('ACTIVE_ID:')) return
  if (line === 'PING' || line.startsWith('PING:')) return

  const isSilentLine = consumeSilentLine(line)

  if (line.startsWith('<') && line.endsWith('>')) {
    const parsed = parseStatusReport(line)
    if (parsed) useMachineStore.getState().updateStatus(parsed)
    return
  }

  const gcState = parseGcStateLine(line)
  if (gcState) {
    useMachineStore.getState().updateStatus(gcState)
    if (isSilentLine) return
    lineHandlers.forEach(fn => fn(line))
    return
  }

  const controllerSettings = parseControllerSettingLine(line)
  if (controllerSettings) {
    useMachineStore.getState().updateControllerSettings(controllerSettings)
    if (isSilentLine) return
    lineHandlers.forEach(fn => fn(line))
    return
  }

  if (isSilentLine) return

  const alarmMatch = line.match(/^Active alarm:\s*(\d+)\s*\(([^)]+)\)/)
  if (alarmMatch) {
    useMachineStore.getState().updateStatus({ alarmName: alarmMatch[2] })
    lineHandlers.forEach(fn => fn(line))
    return
  }

  const alarmCodeMatch = line.match(/^ALARM:(\d+)$/)
  if (alarmCodeMatch) {
    useMachineStore.getState().updateStatus({ alarmCode: parseInt(alarmCodeMatch[1], 10) })
    lineHandlers.forEach(fn => fn(line))
    return
  }

  const msgAlarmMatch = line.match(/\[MSG:INFO:\s*ALARM:\s*(.+?)\]/)
  if (msgAlarmMatch) {
    useMachineStore.getState().updateStatus({ alarmName: msgAlarmMatch[1].trim() })
    lineHandlers.forEach(fn => fn(line))
    return
  }

  if (line.startsWith('{"EEPROM":') || line.startsWith('{"cmd":"400"')) return

  if (line === 'ok' || line === 'error') {
    for (const [ackKey, ackData] of pendingAcknowledgments.entries()) {
      clearTimeout(ackData.timeoutId)
      ackData.callback()
      pendingAcknowledgments.delete(ackKey)
      break
    }
  }

  if (line === 'ok' && pendingPingOks > 0) { pendingPingOks--; return }

  lineHandlers.forEach(fn => fn(line))
}

function persistPageId() {
  try { sessionStorage.setItem('fluidui_pageid', pageId) } catch { /* noop */ }
}

// ──────────────────────────────────────────────────────────────────────────
// Public send API
// ──────────────────────────────────────────────────────────────────────────

export function sendRaw(cmd: string) {
  queueCommand({ command: cmd, isRealtime: false, priority: 'normal', timestamp: Date.now() })
  return socket?.readyState === WebSocket.OPEN
}

export function sendSilentRaw(cmd: string, silentResponseMatcher: SilentResponseMatcher) {
  queueCommand({
    command: cmd,
    isRealtime: false,
    priority: 'normal',
    timestamp: Date.now(),
    silentResponseMatcher,
  })
  return socket?.readyState === WebSocket.OPEN
}

export function sendSilentAlarmQuery() {
  return sendSilentRaw('$A', ALARM_QUERY_SILENT_RESPONSE)
}

export function sendRealtime(byte: number) {
  queueCommand({ command: byte.toString(), isRealtime: true, priority: 'normal', timestamp: Date.now() })
  return socket?.readyState === WebSocket.OPEN
}

export function sendPriorityCancel(): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false
    const done = (ok: boolean) => { if (!resolved) { resolved = true; resolve(ok) } }
    queueCommand({
      command: '133',
      isRealtime: true,
      priority: 'high',
      timestamp: Date.now(),
      acknowledgmentCallback: () => done(true),
      timeoutMs: 1000,
    })
    setTimeout(() => done(false), 1000)
  })
}

export function sendBurstCancel(): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false
    let completed = 0
    const expected = 5
    const done = (ok: boolean) => { if (!resolved) { resolved = true; resolve(ok) } }
    for (let i = 0; i < expected; i++) {
      queueCommand({
        command: '133',
        isRealtime: true,
        priority: 'high',
        timestamp: Date.now() + i,
        acknowledgmentCallback: () => { if (++completed >= expected) done(true) },
        timeoutMs: 1000,
      })
    }
    setTimeout(() => done(false), 2000)
  })
}

export function sendAggressiveBurstCancel(): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false
    let completed = 0
    const expected = 10
    const done = (ok: boolean) => { if (!resolved) { resolved = true; resolve(ok) } }
    for (let i = 0; i < expected; i++) {
      queueCommand({
        command: '133',
        isRealtime: true,
        priority: 'emergency',
        timestamp: Date.now() + i,
        acknowledgmentCallback: () => { if (++completed >= expected) done(true) },
        timeoutMs: 500,
      })
    }
    setTimeout(() => done(false), 1000)
  })
}

export function getConnectionHealth(): ConnectionHealth {
  return { ...connectionHealth }
}

export function isSocketOpen(): boolean {
  return socket?.readyState === WebSocket.OPEN
}

export function disconnect() {
  generation++
  stopPing()
  stopLivenessWatchdog()
  stopStatusPoll()
  stopCommandProcessor()
  pendingSilentResponses.length = 0
  activeSilentResponse = null
  pendingAcknowledgments.forEach(({ timeoutId }) => clearTimeout(timeoutId))
  pendingAcknowledgments.clear()
  commandQueue.length = 0
  closeCurrentSocket()
  if (useMachineStore.getState().connected) {
    useMachineStore.getState().setConnected(false)
  }
}
