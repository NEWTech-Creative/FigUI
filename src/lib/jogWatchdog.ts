import { useMachineStore } from '../store'
import { sendRealtime } from './ws'

const WATCHDOG_INTERVAL_MS = 50

/** Time to wait before escalating to more aggressive cancellation */
const ESCALATION_LEVEL_1_MS = 100  // Single cancel
const ESCALATION_LEVEL_2_MS = 500  // Burst cancels
const ESCALATION_LEVEL_3_MS = 1000 // Aggressive burst cancels (NO soft reset!)

/** Maximum time without input before considering input inactive */
const INPUT_TIMEOUT_MS = 200  // Increased from 100ms for better compatibility

/** Connection health: max time without response before concern */
const CONNECTION_TIMEOUT_MS = 2000

/** Max missed pings before emergency action */
const MAX_MISSED_PINGS = 5

interface WatchdogState {
  enabled: boolean
  monitoring: boolean
  alertLevel: 'none' | 'warning' | 'emergency'
  lastTrigger: number
  escalationStartTime: number
  localJogActive: boolean  // True only when this browser instance initiated the current jog
  inputState: {
    activeKeys: Set<string>
    mouseDown: boolean  // Tracks mouse/pointer/touch input state across all event types
    lastActivity: number
  }
  connectionHealth: {
    lastResponse: number
    missedPings: number
  }
}


let watchdogState: WatchdogState = {
  enabled: false,
  monitoring: false,
  alertLevel: 'none',
  lastTrigger: 0,
  escalationStartTime: 0,
  localJogActive: false,
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

let watchdogTimer: ReturnType<typeof setInterval> | null = null
let eventListenersAttached = false

function updateInputActivity() {
  watchdogState.inputState.lastActivity = Date.now()
}

function handleKeyDown(e: KeyboardEvent) {
  // Only track jogging keys
  const joggingKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract']
  if (joggingKeys.includes(e.code)) {
    watchdogState.inputState.activeKeys.add(e.code)
    updateInputActivity()
  }
}

function handleKeyUp(e: KeyboardEvent) {
  watchdogState.inputState.activeKeys.delete(e.code)
  if (watchdogState.inputState.activeKeys.size === 0) {
    updateInputActivity()
  }
}

function handleMouseDown() {
  watchdogState.inputState.mouseDown = true
  updateInputActivity()
}

function handleMouseUp() {
  watchdogState.inputState.mouseDown = false
  updateInputActivity()
}

function handlePointerDown() {
  watchdogState.inputState.mouseDown = true
  updateInputActivity()
}

function handlePointerUp() {
  watchdogState.inputState.mouseDown = false
  updateInputActivity()
}

function handleWindowBlur() {
  // Clear all input states when window loses focus
  watchdogState.inputState.activeKeys.clear()
  watchdogState.inputState.mouseDown = false
  updateInputActivity()
}

function attachEventListeners() {
  if (eventListenersAttached) return

  document.addEventListener('keydown', handleKeyDown, true)
  document.addEventListener('keyup', handleKeyUp, true)
  document.addEventListener('mousedown', handleMouseDown, true)
  document.addEventListener('mouseup', handleMouseUp, true)
  document.addEventListener('pointerdown', handlePointerDown, true)
  document.addEventListener('pointerup', handlePointerUp, true)
  window.addEventListener('blur', handleWindowBlur)
  window.addEventListener('focus', updateInputActivity)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      handleWindowBlur()
    } else {
      updateInputActivity()
    }
  })

  eventListenersAttached = true
}

function detachEventListeners() {
  if (!eventListenersAttached) return

  document.removeEventListener('keydown', handleKeyDown, true)
  document.removeEventListener('keyup', handleKeyUp, true)
  document.removeEventListener('mousedown', handleMouseDown, true)
  document.removeEventListener('mouseup', handleMouseUp, true)
  document.removeEventListener('pointerdown', handlePointerDown, true)
  document.removeEventListener('pointerup', handlePointerUp, true)
  window.removeEventListener('blur', handleWindowBlur)
  window.removeEventListener('focus', updateInputActivity)

  eventListenersAttached = false
}

function sendJogCancel() {
  sendRealtime(0x85)
  watchdogState.lastTrigger = Date.now()
}

function sendBurstJogCancel() {
  // Send immediate cancel
  sendRealtime(0x85)
  // Send additional cancels with timing to ensure one arrives after any in-flight command
  setTimeout(() => sendRealtime(0x85), 40)
  setTimeout(() => sendRealtime(0x85), 80)
  setTimeout(() => sendRealtime(0x85), 120)
  setTimeout(() => sendRealtime(0x85), 160)

  watchdogState.alertLevel = 'warning'
  watchdogState.lastTrigger = Date.now()
}

function sendAggressiveBurstCancel() {
  // Send immediate cancel
  sendRealtime(0x85)
  // Send many more cancels with aggressive timing
  setTimeout(() => sendRealtime(0x85), 10)
  setTimeout(() => sendRealtime(0x85), 20)
  setTimeout(() => sendRealtime(0x85), 40)
  setTimeout(() => sendRealtime(0x85), 60)
  setTimeout(() => sendRealtime(0x85), 80)
  setTimeout(() => sendRealtime(0x85), 100)
  setTimeout(() => sendRealtime(0x85), 120)
  setTimeout(() => sendRealtime(0x85), 140)
  setTimeout(() => sendRealtime(0x85), 160)
  setTimeout(() => sendRealtime(0x85), 200)

  watchdogState.alertLevel = 'emergency'
  watchdogState.lastTrigger = Date.now()

  // Update store
  const store = useMachineStore.getState()
  store.setWatchdogState({
    ...watchdogState,
    alertLevel: 'emergency'
  })
}


function hasActiveInput(): boolean {
  const now = Date.now()
  const timeSinceInput = now - watchdogState.inputState.lastActivity

  return (
    watchdogState.inputState.activeKeys.size > 0 ||
    watchdogState.inputState.mouseDown ||
    timeSinceInput < INPUT_TIMEOUT_MS
  )
}

function isMachineJogging(): boolean {
  const store = useMachineStore.getState()
  return store.status.state === 'Jog'
}

function isConnectionHealthy(): boolean {
  const now = Date.now()
  const timeSinceResponse = now - watchdogState.connectionHealth.lastResponse

  return (
    timeSinceResponse < CONNECTION_TIMEOUT_MS &&
    watchdogState.connectionHealth.missedPings < MAX_MISSED_PINGS
  )
}

function checkSafetyConditions(): void {
  if (!watchdogState.enabled || !watchdogState.monitoring) return

  const store = useMachineStore.getState()
  const machineJogging = isMachineJogging()
  const inputActive = hasActiveInput()
  const connectionHealthy = isConnectionHealthy()
  const activeStepJog = store.activeStepJog

  // Update store with current watchdog state
  store.setWatchdogState({
    ...watchdogState,
    inputState: { ...watchdogState.inputState }
  })

  // Auto-release ownership when machine is no longer jogging
  if (!machineJogging && watchdogState.localJogActive) {
    watchdogState.localJogActive = false
  }

  // Critical safety condition: this instance owns the jog, machine is jogging, but no active input
  if (machineJogging && watchdogState.localJogActive && !inputActive) {
    const now = Date.now()
    let shouldCancel = false

    // If there's an active step jog, allow it more time to complete
    if (activeStepJog?.active) {
      const stepJogAge = now - activeStepJog.startTime
      // Only cancel step jogs if they've been running for more than 30 seconds
      // (this handles cases where step jogs are extremely slow or stuck)
      shouldCancel = stepJogAge > 30000
    } else {
      // No active step jog, so this must be continuous mode or unexpected jog
      // Apply normal safety cancellation
      shouldCancel = true
    }

    if (shouldCancel) {
      // Start escalation timer if this is a new unsafe condition
      if (watchdogState.escalationStartTime === 0) {
        watchdogState.escalationStartTime = now
      }

      const escalationTime = now - watchdogState.escalationStartTime

      // Escalate responses based on time
      if (escalationTime >= ESCALATION_LEVEL_3_MS) {
        // Level 3: Aggressive burst cancels (no soft reset!)
        sendAggressiveBurstCancel()
      } else if (escalationTime >= ESCALATION_LEVEL_2_MS) {
        // Level 2: Burst cancels
        sendBurstJogCancel()
      } else if (escalationTime >= ESCALATION_LEVEL_1_MS) {
        // Level 1: Single cancel
        sendJogCancel()
      }
    }

  } else {
    // Safe condition - reset escalation
    if (watchdogState.escalationStartTime > 0) {
      watchdogState.escalationStartTime = 0
      watchdogState.alertLevel = 'none'
    }
  }

  // Handle connection health issues
  if (!connectionHealthy && machineJogging) {
    sendAggressiveBurstCancel()
  }
}

export function startWatchdog(): void {
  if (watchdogState.monitoring) return

  watchdogState.enabled = true
  watchdogState.monitoring = true
  watchdogState.alertLevel = 'none'
  watchdogState.escalationStartTime = 0

  attachEventListeners()

  watchdogTimer = setInterval(checkSafetyConditions, WATCHDOG_INTERVAL_MS)

  // Update store
  const store = useMachineStore.getState()
  store.setWatchdogState({ ...watchdogState })
}

export function stopWatchdog(): void {
  if (!watchdogState.monitoring) return

  watchdogState.monitoring = false

  if (watchdogTimer) {
    clearInterval(watchdogTimer)
    watchdogTimer = null
  }

  detachEventListeners()

  // Reset state
  watchdogState.alertLevel = 'none'
  watchdogState.escalationStartTime = 0
  watchdogState.localJogActive = false
  watchdogState.inputState.activeKeys.clear()
  watchdogState.inputState.mouseDown = false

  // Update store
  const store = useMachineStore.getState()
  store.setWatchdogState({ ...watchdogState })
}

export function enableWatchdog(): void {
  watchdogState.enabled = true
  if (!watchdogState.monitoring) {
    startWatchdog()
  }
}

export function disableWatchdog(): void {
  watchdogState.enabled = false
  if (watchdogState.monitoring) {
    stopWatchdog()
  }
}

export function setLocalJogActive(active: boolean): void {
  watchdogState.localJogActive = active
}

export function updateConnectionHealth(lastResponse?: number, missedPings?: number): void {
  if (lastResponse !== undefined) {
    watchdogState.connectionHealth.lastResponse = lastResponse
  }
  if (missedPings !== undefined) {
    watchdogState.connectionHealth.missedPings = missedPings
  }
}

export function getWatchdogState(): WatchdogState {
  return { ...watchdogState, inputState: { ...watchdogState.inputState } }
}

export function resetWatchdogAlert(): void {
  watchdogState.alertLevel = 'none'
  watchdogState.lastTrigger = 0
  watchdogState.escalationStartTime = 0

  const store = useMachineStore.getState()
  store.setWatchdogState({ ...watchdogState })
}

if (typeof window !== 'undefined') {
}