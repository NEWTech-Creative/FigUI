export const GCODE_EXTENSIONS = [
  '.g',
  '.gc',
  '.gco',
  '.gcode',
  '.nc',
  '.ncc',
  '.ngc',
  '.tap',
  '.cnc',
  '.dnc',
  '.eia',
  '.iso',
  '.min',
  '.mpf',
  '.spf',
] as const

export const GCODE_EXTENSION_SET = new Set<string>(GCODE_EXTENSIONS)

export const GCODE_ACCEPT_ATTRIBUTE = GCODE_EXTENSIONS.join(',')

export function getFileExtension(name: string) {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

export function isGCodeFileName(name: string) {
  return GCODE_EXTENSION_SET.has(getFileExtension(name))
}
