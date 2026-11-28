import test from 'node:test'
import assert from 'node:assert/strict'
import { readLegacyAplusStage, describeAplusStage } from '../shared/aplus-run-status.ts'

test('legacy file totals stay separate from receipt and human-attendance evidence', () => {
  const event = readLegacyAplusStage('complete', '確定明細 0件・未請求 1件を保存')
  assert.deepEqual([event.statementFiles, event.pendingFiles], [0, 1])
  assert.equal(event.month, undefined)
  assert.equal(describeAplusStage({...event, scheduledDay:'2026-11-28'}), '2026-11-28 定時取得 · 取得処理 · PCからの保存報告：確定明細 0件・未請求 1件')
  assert.match(describeAplusStage({attempt:'legacy-terminal',stage:'complete',outcome:'succeeded'}), /件数の記録なし/)
  assert.match(describeAplusStage(readLegacyAplusStage('verification_required', 'fixture')), /確認操作を求めました/)
})

test('only bounded legacy summary shapes become file totals', () => {
  for (const text of ['確定明細 9999999件・未請求 1件を保存','確定明細 1件・未請求 0件を保存\n','確定明細 1件・未請求 0件を保存（未提供: 2026-15）']) assert.equal(readLegacyAplusStage('complete',text), null)
  const partial = readLegacyAplusStage('complete','確定明細 1件・未請求 0件を保存（未提供: 2026-11, 2026-12）')
  assert.equal(partial.statementFiles,1)
  assert.equal(partial.month,undefined)
})
