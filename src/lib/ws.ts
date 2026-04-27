import { parseStatusReport } from './parser'
import { useMachineStore } from '../store'

let socket: WebSocket | null = null
let pingTimer: ReturnType<typeof setInterval> | null = null
let pageId = String(Math.floor(Math.random() * 9000) + 1000)
let suppressNextOk = false


interface ConnectionHealth {
  lastPingTime: number
  lastResponseTime: number
  missedPings: number
}

let connectionHealth: ConnectionHealth = {
  lastPingTime: 0,
  lastResponseTime: Date.now(),
  missedPings: 0
}

type ConnectionHealthCallback = (health: ConnectionHealth) => void
const connectionCallbacks = new Set<ConnectionHealthCallback>()

export function onConnectionHealth(callback: ConnectionHealthCallback): () => void {
  connectionCallbacks.add(callback)
  return () => { connectionCallbacks.delete(callback) }
}

function updateConnectionHealth() {
  connectionCallbacks.forEach(callback => callback({ ...connectionHealth }))
}


interface QueuedCommand {
  command: string
  isRealtime: boolean
  priority: 'normal' | 'high' | 'emergency'
  timestamp: number
  acknowledgmentCallback?: () => void
  timeoutMs?: number
}

const commandQueue: QueuedCommand[] = []
let commandProcessor: ReturnType<typeof setInterval> | null = null
let pendingAcknowledgments = new Map<string, { callback: () => void, timeoutId: ReturnType<typeof setTimeout> }>()

function startCommandProcessor() {
  if (commandProcessor) return
  commandProcessor = setInterval(processCommandQueue, 10) // 10ms processing interval
}

function stopCommandProcessor() {
  if (commandProcessor) {
    clearInterval(commandProcessor)
    commandProcessor = null
  }
}

function processCommandQueue() {
  if (commandQueue.length === 0 || socket?.readyState !== WebSocket.OPEN) return

  // Sort by priority: emergency > high > normal, then by timestamp for same priority
  commandQueue.sort((a, b) => {
    const priorityOrder = { 'emergency': 0, 'high': 1, 'normal': 2 }
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
    return priorityDiff !== 0 ? priorityDiff : a.timestamp - b.timestamp
  })

  const command = commandQueue.shift()
  if (!command) return

  // Send the command
  if (command.isRealtime) {
    const buf = new Uint8Array(1)
    buf[0] = parseInt(command.command)
    socket!.send(buf)
  } else {
    socket!.send(new TextEncoder().encode(command.command + '\n'))
  }

  // Set up acknowledgment tracking if provided
  if (command.acknowledgmentCallback) {
    const ackKey = `${command.command}_${command.timestamp}`
    const timeoutId = setTimeout(() => {
      pendingAcknowledgments.delete(ackKey)
    }, command.timeoutMs || 5000)

    pendingAcknowledgments.set(ackKey, {
      callback: command.acknowledgmentCallback,
      timeoutId
    })
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

export function connect(host: string): Promise<void> {
  const MAX_ATTEMPTS = 4   // try up to 4 times before giving up
  const RETRY_DELAY  = 1500 // ms between retries

  return new Promise((resolve, reject) => {
    let attempts = 0
    let settled  = false

    function tryOnce() {
      // Detach stale handlers then close the old socket before creating a new one
      if (socket) {
        const stale = socket
        stale.onopen = stale.onclose = stale.onerror = stale.onmessage = null
        stale.close()
        socket = null
      }
      clearPing()

      const ws = new WebSocket(`ws://${host}/`, 'arduino')
      ws.binaryType = 'arraybuffer'
      socket = ws

      const timeout = setTimeout(() => {
        onFailure(new Error('WebSocket connection timed out'))
      }, 5000)

      function onFailure(err: Error) {
        clearTimeout(timeout)
        if (settled) return
        attempts++
        if (attempts < MAX_ATTEMPTS) {
          setTimeout(tryOnce, RETRY_DELAY)
        } else {
          settled = true
          reject(err)
        }
      }

      ws.onopen = () => {
        if (ws !== socket || settled) return
        clearTimeout(timeout)
        settled = true
        useMachineStore.getState().setConnected(true)

        // Reset connection health
        connectionHealth.lastResponseTime = Date.now()
        connectionHealth.missedPings = 0
        updateConnectionHealth()

        // Start command processor
        startCommandProcessor()

        // Ask FluidNC to replay its startup log so the terminal shows
        // version, WiFi status, config warnings, etc. on every (re)connect.
        ws.send(new TextEncoder().encode('$SS\n'))

        pingTimer = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            suppressNextOk = true
            connectionHealth.lastPingTime = Date.now()
            socket.send(`PING:${pageId}\n`)

            // Check if too much time has passed since last response
            const timeSinceResponse = Date.now() - connectionHealth.lastResponseTime
            if (timeSinceResponse > 15000) { // 15 seconds
              connectionHealth.missedPings++
              updateConnectionHealth()
            }
          }
        }, 10_000)
        resolve()
      }

      ws.onclose = () => {
        if (ws !== socket) return
        clearTimeout(timeout)
        clearPing()
        stopCommandProcessor()
        useMachineStore.getState().setConnected(false)
      }

      ws.onerror = () => {
        if (ws !== socket) return
        onFailure(new Error(`Could not connect to ws://${host}/`))
      }

      ws.onmessage = (ev) => {
        if (ws !== socket) return
        const text =
          ev.data instanceof ArrayBuffer
            ? new TextDecoder().decode(ev.data)
            : String(ev.data)
        text.split('\n').forEach(raw => {
          const line = raw.trim()
          if (line) handleLine(line)
        })
      }
    }

    tryOnce()
  })
}

function handleLine(line: string) {
  // Update connection health on any received message
  connectionHealth.lastResponseTime = Date.now()
  connectionHealth.missedPings = 0
  updateConnectionHealth()

  if (line.startsWith('currentID:')) { pageId = line.slice(10); return }  // webui3
  if (line.startsWith('CURRENT_ID:')) { pageId = line.slice(11); return } // webui2
  if (line.startsWith('activeID:') || line.startsWith('ACTIVE_ID:')) return
  if (line === 'PING' || line.startsWith('PING:')) return

  if (line.startsWith('<') && line.endsWith('>')) {
    const parsed = parseStatusReport(line)
    if (parsed) useMachineStore.getState().updateStatus(parsed)
    return
  }

  // Parse $A response: "Active alarm: 3 (Abort Cycle)"
  const alarmMatch = line.match(/^Active alarm:\s*(\d+)\s*\(([^)]+)\)/)
  if (alarmMatch) {
    useMachineStore.getState().updateStatus({ alarmName: alarmMatch[2] })
    lineHandlers.forEach(fn => fn(line))
    return
  }

  // Parse "ALARM:3" — set alarmCode immediately before status report arrives
  const alarmCodeMatch = line.match(/^ALARM:(\d+)$/)
  if (alarmCodeMatch) {
    useMachineStore.getState().updateStatus({ alarmCode: parseInt(alarmCodeMatch[1], 10) })
    lineHandlers.forEach(fn => fn(line))
    return
  }

  // Parse "[MSG:INFO: ALARM: Abort Cycle]" — capture alarm name immediately
  const msgAlarmMatch = line.match(/\[MSG:INFO:\s*ALARM:\s*(.+?)\]/)
  if (msgAlarmMatch) {
    useMachineStore.getState().updateStatus({ alarmName: msgAlarmMatch[1].trim() })
    lineHandlers.forEach(fn => fn(line))
    return
  }

  // Suppress large settings blobs broadcast to WS by /command
  if (line.startsWith('{"EEPROM":') || line.startsWith('{"cmd":"400"')) return

  // Handle command acknowledgments
  if (line === 'ok' || line === 'error') {
    // Try to match pending acknowledgments
    for (const [ackKey, ackData] of pendingAcknowledgments.entries()) {
      clearTimeout(ackData.timeoutId)
      ackData.callback()
      pendingAcknowledgments.delete(ackKey)
      break // Only handle one acknowledgment per response
    }
  }

  // Suppress the ok echoed back for our PING keepalive
  if (line === 'ok' && suppressNextOk) { suppressNextOk = false; return }

  lineHandlers.forEach(fn => fn(line))
}

export function sendRaw(cmd: string) {
  const command: QueuedCommand = {
    command: cmd,
    isRealtime: false,
    priority: 'normal',
    timestamp: Date.now()
  }
  queueCommand(command)
  return socket?.readyState === WebSocket.OPEN
}

export function sendRealtime(byte: number) {
  const command: QueuedCommand = {
    command: byte.toString(),
    isRealtime: true,
    priority: 'normal',
    timestamp: Date.now()
  }
  queueCommand(command)
  return socket?.readyState === WebSocket.OPEN
}


export function sendPriorityCancel(): Promise<boolean> {
  return new Promise((resolve) => {
    const command: QueuedCommand = {
      command: '133', // 0x85 in decimal
      isRealtime: true,
      priority: 'high',
      timestamp: Date.now(),
      acknowledgmentCallback: () => resolve(true),
      timeoutMs: 1000
    }
    queueCommand(command)

    // Timeout fallback
    setTimeout(() => resolve(false), 1000)
  })
}

export function sendBurstCancel(): Promise<boolean> {
  return new Promise((resolve) => {
    let completedCount = 0
    const expectedCount = 5

    function onCancelComplete() {
      completedCount++
      if (completedCount >= expectedCount) {
        resolve(true)
      }
    }

    // Send burst of 5 cancel commands
    for (let i = 0; i < expectedCount; i++) {
      const command: QueuedCommand = {
        command: '133', // 0x85 in decimal
        isRealtime: true,
        priority: 'high',
        timestamp: Date.now() + i, // Slightly different timestamps
        acknowledgmentCallback: onCancelComplete,
        timeoutMs: 1000
      }
      queueCommand(command)
    }

    // Timeout fallback
    setTimeout(() => resolve(false), 2000)
  })
}

export function sendAggressiveBurstCancel(): Promise<boolean> {
  return new Promise((resolve) => {
    let completedCount = 0
    const expectedCount = 10

    function onCancelComplete() {
      completedCount++
      if (completedCount >= expectedCount) {
        resolve(true)
      }
    }

    // Send aggressive burst of 10 cancel commands
    for (let i = 0; i < expectedCount; i++) {
      const command: QueuedCommand = {
        command: '133', // 0x85 in decimal
        isRealtime: true,
        priority: 'emergency',
        timestamp: Date.now() + i, // Slightly different timestamps
        acknowledgmentCallback: onCancelComplete,
        timeoutMs: 500
      }
      queueCommand(command)
    }

    // Timeout fallback
    setTimeout(() => resolve(false), 1000)
  })
}

export function getConnectionHealth(): ConnectionHealth {
  return { ...connectionHealth }
}

export function disconnect() {
  clearPing()
  stopCommandProcessor()

  // Clear pending acknowledgments
  pendingAcknowledgments.forEach(({ timeoutId }) => clearTimeout(timeoutId))
  pendingAcknowledgments.clear()

  // Clear command queue
  commandQueue.length = 0

  socket?.close()
  socket = null
}

function clearPing() {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
}
