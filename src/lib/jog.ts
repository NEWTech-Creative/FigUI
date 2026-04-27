export function loadPersistedJogFeed(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

export function jogFeedKeyForAxis(axis: string) {
  if (axis === 'Z') return ['jog.zFeed', 200] as const
  if (axis === 'A' || axis === 'B' || axis === 'C') return ['jog.abcFeed', 500] as const
  return ['jog.xyFeed', 1000] as const
}