import type { Units } from '../types'

export const MM_PER_INCH = 25.4

export function isRotaryAxis(axis: string) {
  return axis === 'A' || axis === 'B' || axis === 'C'
}

export function mmToDisplay(mm: number, units: Units) {
  return units === 'in' ? mm / MM_PER_INCH : mm
}

export function displayToMm(value: number, units: Units) {
  return units === 'in' ? value * MM_PER_INCH : value
}

export function axisValueToDisplay(value: number, axis: string, units: Units) {
  return isRotaryAxis(axis) ? value : mmToDisplay(value, units)
}

export function axisStepToCommand(step: number, axis: string, units: Units) {
  return isRotaryAxis(axis) ? step : displayToMm(step, units)
}

export function formatAxisCoord(value: number, axis: string, units: Units) {
  const displayValue = axisValueToDisplay(value, axis, units)
  const decimals = isRotaryAxis(axis) ? 3 : units === 'in' ? 4 : 3
  const formatted = displayValue.toFixed(decimals)
  return displayValue >= 0 ? ` ${formatted}` : formatted
}

export function formatFeedRate(mmPerMin: number, units: Units) {
  if (units === 'in') return trimTrailingZeros((mmPerMin / MM_PER_INCH).toFixed(2))
  return Math.round(mmPerMin).toString()
}

export function formatDisplayNumber(value: number, decimals: number) {
  return trimTrailingZeros(value.toFixed(decimals))
}

export function linearUnitLabel(units: Units) {
  return units === 'in' ? 'in' : 'mm'
}

export function feedUnitLabel(units: Units) {
  return units === 'in' ? 'in/min' : 'mm/min'
}

export function droFeedUnitLabel(units: Units) {
  return units === 'in' ? 'in/m' : 'mm/m'
}

function trimTrailingZeros(value: string) {
  return value.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '')
}
