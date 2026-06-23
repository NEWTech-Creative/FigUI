import { useMachineStore } from '../store'
import { sendCommand } from './http'
import { parseESP400Settings } from './parser'
import type { FluidNCSetting } from '../types'

let inFlight: Promise<FluidNCSetting[]> | null = null

export async function loadControllerConfigSettings(force = false): Promise<FluidNCSetting[]> {
  const store = useMachineStore.getState()
  if (!force && store.controllerConfigSettings) return store.controllerConfigSettings
  if (inFlight) return inFlight

  store.setControllerConfigLoading(true)
  store.setControllerConfigError(null)

  inFlight = sendCommand('[ESP400]')
    .then(raw => {
      const settings = parseESP400Settings(raw)
      useMachineStore.getState().setControllerConfigSettings(settings)
      return settings
    })
    .catch(error => {
      const message = error instanceof Error ? error.message : 'Failed to load settings'
      useMachineStore.getState().setControllerConfigError(message)
      throw error
    })
    .finally(() => {
      inFlight = null
      useMachineStore.getState().setControllerConfigLoading(false)
    })

  return inFlight
}

export function prefetchControllerConfigSettings() {
  loadControllerConfigSettings(false).catch(() => {})
}
