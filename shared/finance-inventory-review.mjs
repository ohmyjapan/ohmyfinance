// Evidence packets are imported privately by an operator, never from browser input.
export function validateInventoryPacket(packet) {
  const text = (value, max, optional = false) => typeof value === 'string' && value.length <= max && (optional || !!value.trim())
  const price = value => value === null || (Number.isSafeInteger(value) && value >= 0 && value <= 1e12)
  const safeUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password } catch { return false } }
  if (!packet || packet.version !== 1 || !text(packet.productName, 500) || !['strong', 'conditional'].includes(packet.strength) || !text(packet.explanation, 4000) || !text(packet.capturedAt, 40) || !Number.isFinite(Date.parse(packet.capturedAt))) throw Error('商品候補の形式を確認してください。')
  if (!price(packet.itemTotal) || !price(packet.shipping)) throw Error('商品候補の金額を確認してください。')
  if (!Array.isArray(packet.items) || !packet.items.length || packet.items.length > 50 || packet.items.some(i => !i || !text(i.stockId, 100) || !text(i.productName, 500) || !text(i.productCode, 100, true) || !text(i.option, 200, true) || !text(i.assignedDate, 30, true) || !text(i.knownPrice, 100, true) || !Number.isSafeInteger(i.sheetRow) || i.sheetRow < 1)) throw Error('在庫の根拠を確認してください。')
  if (!Array.isArray(packet.sources) || !packet.sources.length || packet.sources.length > 20 || packet.sources.some(s => !s || !text(s.label, 200) || !text(s.note, 4000, true) || !text(s.url, 2000) || !safeUrl(s.url))) throw Error('出典の形式を確認してください。')
  return packet
}
export function inventoryCodes(packet) {
  return [...new Set(packet.items.map(i => i.productCode.normalize('NFKC').toUpperCase().replace(/\s+/g, ' ').trim()).filter(Boolean))].sort()
}
export function inventoryDecision(body, packet) {
  if (!body || !['accepted', 'corrected', 'rejected', 'pending'].includes(body.status)) throw Error('判断を選択してください。')
  if (typeof body.note !== 'string') throw Error('理由の形式を確認してください。')
  const note = body.note.trim()
  if (note.length > 2000 || (['corrected', 'rejected'].includes(body.status) && !note)) throw Error('修正・除外の理由を入力してください。')
  const productName = body.status === 'accepted' ? packet.productName : body.status === 'corrected' && typeof body.productName === 'string' ? body.productName.trim() : ''
  if (body.status === 'corrected' && (!productName || productName.length > 500 || productName === packet.productName)) throw Error('修正後の商品名を入力してください。')
  return { status: body.status, productName, note }
}
export function inventoryCalculation(packet, amount) {
  const total = packet.itemTotal === null || packet.shipping === null ? null : packet.itemTotal + packet.shipping
  return { total, difference: total === null ? null : amount - total }
}
