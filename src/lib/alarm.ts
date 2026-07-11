import { sendRaw, sendRealtime } from './ws'

const UNLOCKABLE_ALARMS = new Set([4, 5, 6, 7, 8, 9, 14])

export function alarmRequiresSoftReset(alarmCode: number | undefined) {
  return alarmCode == null || !UNLOCKABLE_ALARMS.has(alarmCode)
}

export function clearMachineAlarm(alarmCode: number | undefined) {
  if (!alarmRequiresSoftReset(alarmCode)) {
    sendRaw('$X')
    return
  }

  if (confirm('This type of alarm requires a soft reset to clear. Continue?')) {
    sendRealtime(0x18)
  }
}
