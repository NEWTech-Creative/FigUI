import { sendRaw } from './ws'
import { fetchFileContent } from './http'
import type { Macro } from '../types'

export async function runMacro(macro: Macro): Promise<void> {
  let command = macro.command
  if (!command && macro.filename && macro.target) {
    try {
      const path = macro.target === 'SD' ? `/sd${macro.filename}` : macro.filename
      command = await fetchFileContent(path, macro.target === 'SD' ? 'sd' : 'local')
    } catch {
      return
    }
  }
  if (!command) return
  for (const line of command.split('\n').map(l => l.trim()).filter(Boolean)) {
    sendRaw(line)
  }
}

export const MACRO_BTN_CLASS: Record<Macro['color'], string> = {
  default: 'btn-ghost',
  accent:  'btn-accent-soft',
  ok:      'btn-ok',
  warn:    'btn-warn',
  danger:  'btn-danger',
  info:    'btn-info',
  purple:  'btn-purple',
  teal:    'btn-teal',
}
