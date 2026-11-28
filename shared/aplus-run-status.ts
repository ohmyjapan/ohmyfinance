const stages = {
  reconcile: '保存済み明細の照合',
  sign_in: 'サインイン',
  form_selection: '請求月と形式の確認',
  submit: 'ダウンロード要求',
  local_download: 'PCへの保存',
  validation: '明細の検証',
  upload: 'OMFへの送信',
  acknowledgment: '受領確認',
  provisional: '未請求明細の取得',
  complete: '取得処理',
}

const outcomes = {
  started: '開始',
  succeeded: '完了',
  failed: '失敗',
  entry_connection_failed: 'My APLUSの開始ページとの通信が中断しました。ログイン情報は送信していません。次の取得結果を確認してください',
  ambiguous: '対象を特定できません',
  denied: 'アクセスが拒否されました',
  operator_needed: '操作が必要です。PCのダウンローダーで案内を確認してください',
  missing_receipt: '受領記録がありません',
  uncertain: '受領を確認できません。保存済みの明細を確認し、必要ならOMFに取り込んでください',
  invalid_credentials: 'My APLUSがログイン情報を拒否しました。PCでログイン情報を保存し直してください',
  login_disabled: 'My APLUSのログインIDが利用停止中です。利用再開後にPCでログイン情報を保存し直してください',
  login_unconfirmed: '保存したログイン情報を確認できません。PCで情報を保存し直すか、立ち会い取得で保存済みの情報を使ってログインしてください。手入力だけでは自動取得は再開しません',
  file_refused: '明細を読み取れません。対象月の正しい原本を確認してOMFに取り込んでください',
  original_missing: 'PCに原本がありません。My APLUSから対象月の確定明細を取得し、OMFに取り込んでください',
  original_damaged: 'PCの原本を検証できません。対象月の確定明細を再取得し、OMFに取り込んでください',
  period_conflict: '同じ原本が別の期間で登録されています。OMFの取込履歴を確認し、対象月の正しい原本を取り込んでください',
  notice_refused: '請求メールの内容を登録できません。元のメールとOMFの請求予定を確認してください',
  mail_report_refused: '請求メールの取得結果を登録できません。PCの取得履歴を確認してください',
  pending_refused: '未請求明細の記録を受け付けられませんでした。PCの取得履歴を確認してください',
  unavailable: '確定明細が未取得です。次回の取得時に再確認します',
}

export interface AplusStage {
  attempt: string
  stage: keyof typeof stages
  outcome: keyof typeof outcomes
  month?: string
  displayState?: 'interrupted' | 'stalled'
}

export interface AplusEvent extends AplusStage {
  jobId: string
  at: string
  state?: string
}

export function readAplusStage(message: string): AplusStage | null {
  const match = /^APLUS ([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}) ([a-z_]+) ([a-z_]+)(?: (20\d{2}-(?:0[1-9]|1[0-2])))?$/.exec(message)
  if (!match || match[0] !== message || !Object.hasOwn(stages, match[2]) || !Object.hasOwn(outcomes, match[3])) return null
  return { attempt: match[1], stage: match[2] as AplusStage['stage'], outcome: match[3] as AplusStage['outcome'], ...(match[4] ? { month: match[4] } : {}) }
}

export function describeAplusStage(event: AplusStage) {
  const step = (event.month ? event.month + ' · ' : '') + stages[event.stage] + ' · ' + outcomes[event.outcome]
  if (event.displayState === 'interrupted') return step + ' の後に中断しました'
  if (event.displayState === 'stalled') return step + ' · PCからの応答を待っています'
  return step
}

// The journal is newest first. Use the first observed event of each attempt to
// establish succession even if a heartbeat from an older attempt arrived late.
export function ownerAplusHistory(events: AplusEvent[], job: {jobId?: string | null, jobState?: string | null, jobLeaseUntil?: Date | string | null}, now = Date.now()) {
  const latestStarted = new Map<string,string>(), seen = new Set<string>()
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i], key = e.jobId + '/' + e.attempt
    if (!seen.has(key)) { seen.add(key); latestStarted.set(e.jobId,e.attempt) }
  }
  seen.clear()
  return events.map(e => {
    const key = e.jobId + '/' + e.attempt
    if (seen.has(key)) return e
    seen.add(key)
    if (e.state === 'complete' || e.state === 'failed' || (e.stage === 'complete' && e.outcome === 'succeeded')) return e
    const superseded = latestStarted.get(e.jobId) !== e.attempt
    if (!e.state && !['started','succeeded'].includes(e.outcome) && !superseded) return e
    if (superseded || job.jobId !== e.jobId || !['running','verification_required'].includes(job.jobState || '')) return {...e,displayState:'interrupted' as const}
    if (job.jobLeaseUntil && new Date(job.jobLeaseUntil).getTime() <= now) return {...e,displayState:'stalled' as const}
    return e
  })
}

// The server returns the newest event first. A reclaim can start another attempt for the same job.
export function aplusAttempts(events: AplusEvent[]) {
  const groups = new Map<string, AplusEvent[]>()
  for (const event of events) {
    const key = event.jobId + '/' + event.attempt
    const group = groups.get(key)
    if (group) group.push(event)
    else groups.set(key, [event])
  }
  return Array.from(groups.values())
}
