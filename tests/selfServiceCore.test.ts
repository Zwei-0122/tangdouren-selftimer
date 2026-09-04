import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getSeatOptionsForTable,
  isValidSelfServiceSeat,
  normalizeTableCode,
  isValidSelfServiceTable,
  normalizeSeatCode,
} from '../lib/timer/selfServiceCore.ts'

test('normalizeTableCode accepts old migration table codes case-insensitively', () => {
  assert.equal(normalizeTableCode(' f1 '), 'F1')
  assert.equal(normalizeTableCode('s6'), 'S6')
  assert.equal(normalizeTableCode('D4'), 'D4')
})

test('isValidSelfServiceTable follows old migration table set', () => {
  for (const code of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'D1', 'D2', 'D3', 'D4', 'F1', 'F2']) {
    assert.equal(isValidSelfServiceTable(code), true, `${code} should be accepted`)
  }
  assert.equal(isValidSelfServiceTable('S7'), false)
  assert.equal(isValidSelfServiceTable('A1'), false)
})

test('getSeatOptionsForTable maps table capacity to seat codes', () => {
  assert.deepEqual(getSeatOptionsForTable('S1'), ['S1'])
  assert.deepEqual(getSeatOptionsForTable('D1'), ['D1A', 'D1B'])
  assert.deepEqual(getSeatOptionsForTable('F2'), ['F2A', 'F2B', 'F2C', 'F2D'])
})

test('normalizeSeatCode validates seat code against selected table', () => {
  assert.equal(normalizeSeatCode('f1', ' f1c '), 'F1C')
  assert.equal(isValidSelfServiceSeat('D2', 'D2B'), true)
  assert.equal(isValidSelfServiceSeat('D2', 'D2C'), false)
  assert.equal(isValidSelfServiceSeat('S1', 'S1A'), false)
  assert.equal(isValidSelfServiceSeat('F1', 'F2A'), false)
})
