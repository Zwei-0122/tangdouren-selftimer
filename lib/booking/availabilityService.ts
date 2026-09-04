import {
  BUSINESS_CONFIG,
  TABLE_DEFINITIONS,
  DISABLED_TABLE_CODES,
  EXACT_TABLE_TYPE,
  SHARING_UPGRADE_TYPE,
  getPartySizeCategory,
  type TableType,
} from './config'
import type {
  ExistingBooking,
  TableDef,
  AvailabilityOption,
  AvailabilityResult,
} from './types'
import {
  timeToMinutes,
  minutesToTime,
  generateTableCandidateStartTimes,
  getValidDurations,
  fitsWithinBusinessHours,
  formatDuration,
} from './timeRuleService'
import {
  isTableFreeForPrivate,
  isSharedSlotAvailable,
} from './resourceMatchingService'
import { buildDisplayTag } from './sharingRuleService'

const cfg = BUSINESS_CONFIG

// ── DB 行 → ExistingBooking 映射 ─────────────────────────────────────────────

type BookingDbRow = Record<string, unknown>

export function mapDbRowToExisting(row: BookingDbRow): ExistingBooking {
  return {
    bookingId:         row.booking_id as string,
    bookingDate:       row.booking_date as string,
    startTime:         row.start_time as string,
    endTime:           row.end_time as string,
    bufferedEndTime:   row.buffered_end_time as string,
    partySize:         row.party_size as number,
    acceptsSharing:    row.accepts_sharing as boolean,
    assignedTableId:   row.assigned_table_id as string,
    assignedTableCode: row.assigned_table_code as string,
    assignedTableType: row.assigned_table_type as TableType,
    bookingMode:       row.booking_mode as ExistingBooking['bookingMode'],
    seatGroupType:     row.seat_group_type as ExistingBooking['seatGroupType'],
    status:            row.status as ExistingBooking['status'],
  }
}

// ── 单个 (startTime, duration) 在某桌上的可用性 ───────────────────────────────

interface SlotCheckResult {
  isPrivateAvailable: boolean
  isSharedAvailable:  boolean
}

function checkSlotOnTable(
  table:         TableDef,
  tableBookings: ExistingBooking[],
  startMin:      number,
  duration:      number,
  category:      ReturnType<typeof getPartySizeCategory>,
  acceptsSharing: boolean,
): SlotCheckResult {
  const endMin    = startMin + duration
  const buffer    = cfg.cleanupBufferMinutes
  const exactType = EXACT_TABLE_TYPE[category]

  let isPrivateAvailable = false
  let isSharedAvailable  = false

  // 私人整桌（桌型严格匹配）
  if (table.tableType === exactType) {
    isPrivateAvailable = isTableFreeForPrivate(tableBookings, startMin, endMin, buffer)
  }

  // 拼桌升级（需要 acceptsSharing）
  if (acceptsSharing) {
    const upgradeType = SHARING_UPGRADE_TYPE[category]
    if (upgradeType && table.tableType === upgradeType) {
      isSharedAvailable = isSharedSlotAvailable(
        table, tableBookings, category, category === 'single' ? 1 : 2,
        startMin, endMin, buffer,
      )
    }
  }

  return { isPrivateAvailable, isSharedAvailable }
}

// ── 核心：为某日、某人数生成全部可用组合 ──────────────────────────────────────

export interface GetAvailabilityParams {
  partySize:       number   // 1, 2, 或 3（代表 3-4人）
  acceptsSharing:  boolean
  allBookings:     ExistingBooking[]   // 该日所有非取消预约
  startTimeFilter: string | null
  durationFilter:  number | null
}

export function getAvailability(params: GetAvailabilityParams): AvailabilityResult[] {
  const { partySize, acceptsSharing, allBookings, startTimeFilter, durationFilter } = params
  const category  = getPartySizeCategory(partySize)
  const durations = getValidDurations(cfg)

  // 按桌分组预约
  const bookingsByTable = new Map<string, ExistingBooking[]>()
  for (const b of allBookings) {
    const key = b.assignedTableCode
    if (!bookingsByTable.has(key)) bookingsByTable.set(key, [])
    bookingsByTable.get(key)!.push(b)
  }

  // 结果: startTime → options[]（去重用 Map<startTime, Map<key, option>>）
  const resultMap = new Map<number, Map<string, AvailabilityOption>>()

  const tables: TableDef[] = TABLE_DEFINITIONS.map(t => ({
    ...t, isActive: !DISABLED_TABLE_CODES.includes(t.tableCode),
  }))

  for (const table of tables) {
    if (!table.isActive) continue

    const tableBookings = bookingsByTable.get(table.tableCode) ?? []

    // 该桌候选开始时间
    const candidates = generateTableCandidateStartTimes(
      tableBookings.map(b => ({ start_time: b.startTime, end_time: b.endTime })),
      cfg,
    )

    for (const startMin of candidates) {
      // 如果有 startTimeFilter，只处理匹配的时间
      if (startTimeFilter && minutesToTime(startMin) !== startTimeFilter) continue

      const durationsToCheck = durationFilter ? [durationFilter] : durations

      for (const dur of durationsToCheck) {
        if (!fitsWithinBusinessHours(startMin, dur, cfg)) continue

        const { isPrivateAvailable, isSharedAvailable } = checkSlotOnTable(
          table, tableBookings, startMin, dur, category, acceptsSharing,
        )

        if (!resultMap.has(startMin)) resultMap.set(startMin, new Map())
        const slotOptions = resultMap.get(startMin)!

        // 私人选项
        if (isPrivateAvailable) {
          const key = `${dur}_private`
          if (!slotOptions.has(key)) {
            slotOptions.set(key, {
              durationMinutes: dur,
              isSharedOption:  false,
              displayTag:      buildDisplayTag(category, EXACT_TABLE_TYPE[category], false),
              tableType:       EXACT_TABLE_TYPE[category],
            })
          }
        }

        // 拼桌选项
        if (isSharedAvailable) {
          const upgradeType = SHARING_UPGRADE_TYPE[category]!
          const key = `${dur}_shared`
          if (!slotOptions.has(key)) {
            slotOptions.set(key, {
              durationMinutes: dur,
              isSharedOption:  true,
              displayTag:      buildDisplayTag(category, upgradeType, true),
              tableType:       upgradeType,
            })
          }
        }
      }
    }
  }

  // 转换为 AvailabilityResult[]，按时间排序
  const results: AvailabilityResult[] = []
  const sortedTimes = [...resultMap.keys()].sort((a, b) => a - b)

  for (const startMin of sortedTimes) {
    const optionsMap = resultMap.get(startMin)!
    if (optionsMap.size === 0) continue

    // options 按时长升序，同时长内：私人 → 拼桌
    const options = [...optionsMap.values()].sort((a, b) => {
      if (a.durationMinutes !== b.durationMinutes) return a.durationMinutes - b.durationMinutes
      return a.isSharedOption ? 1 : -1
    })

    results.push({ startTime: minutesToTime(startMin), options })
  }

  return results
}

// ── 日期是否已约满（最简规则：任意人数的最短预约是否存在）────────────────────

export function isDateFullyBooked(allBookings: ExistingBooking[]): boolean {
  const minDur   = cfg.minDurationMinutes
  const tables: TableDef[] = TABLE_DEFINITIONS.map(t => ({
    ...t, isActive: !DISABLED_TABLE_CODES.includes(t.tableCode),
  }))

  const bookingsByTable = new Map<string, ExistingBooking[]>()
  for (const b of allBookings) {
    const key = b.assignedTableCode
    if (!bookingsByTable.has(key)) bookingsByTable.set(key, [])
    bookingsByTable.get(key)!.push(b)
  }

  for (const table of tables) {
    const tableBookings = bookingsByTable.get(table.tableCode) ?? []
    const candidates = generateTableCandidateStartTimes(
      tableBookings.map(b => ({ start_time: b.startTime, end_time: b.endTime })),
      cfg,
    )

    for (const startMin of candidates) {
      if (!fitsWithinBusinessHours(startMin, minDur, cfg)) continue
      if (isTableFreeForPrivate(tableBookings, startMin, startMin + minDur, cfg.cleanupBufferMinutes)) {
        return false  // 至少有一个合法 1h 私人预约可用
      }
    }
  }

  return true
}

// ── 时长格式化（供前端展示，此处重导出） ─────────────────────────────────────
export { formatDuration }
