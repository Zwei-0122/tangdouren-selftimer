export const SELF_SERVICE_TABLE_CODES = [
  'S1', 'S2', 'S3', 'S4', 'S5', 'S6',
  'D1', 'D2', 'D3', 'D4',
  'F1', 'F2',
] as const

export type SelfServiceTableCode = typeof SELF_SERVICE_TABLE_CODES[number]

const DOUBLE_SEAT_SUFFIXES = ['A', 'B'] as const
const FOUR_SEAT_SUFFIXES = ['A', 'B', 'C', 'D'] as const

const tableCodeSet = new Set<string>(SELF_SERVICE_TABLE_CODES)

export function normalizeTableCode(value: string): string | null {
  const normalized = value.trim().toUpperCase()
  if (!normalized || normalized.length > 10) return null
  return normalized
}

export function isValidSelfServiceTable(value: string): value is SelfServiceTableCode {
  const normalized = normalizeTableCode(value)
  return normalized !== null && tableCodeSet.has(normalized)
}

export function getSeatOptionsForTable(tableCode: string): string[] {
  const normalized = normalizeTableCode(tableCode)
  if (!normalized || !isValidSelfServiceTable(normalized)) return []

  if (normalized.startsWith('S')) return [normalized]
  if (normalized.startsWith('D')) return DOUBLE_SEAT_SUFFIXES.map(suffix => `${normalized}${suffix}`)
  if (normalized.startsWith('F')) return FOUR_SEAT_SUFFIXES.map(suffix => `${normalized}${suffix}`)
  return []
}

export function normalizeSeatCode(tableCode: string, seatCode: string): string | null {
  const normalizedSeat = seatCode.trim().toUpperCase()
  if (!normalizedSeat || normalizedSeat.length > 10) return null

  const options = getSeatOptionsForTable(tableCode)
  return options.includes(normalizedSeat) ? normalizedSeat : null
}

export function isValidSelfServiceSeat(tableCode: string, seatCode: string): boolean {
  return normalizeSeatCode(tableCode, seatCode) !== null
}
