export type DraftState = 'draft' | 'pending' | 'rejected' | 'discarded' | 'saved' | 'deleted'
export interface ManualDraft {
  id: string; owner: string; key: string; state: DraftState; revision: number
  payload: Record<string, any> | null; previousPayloads: Record<string, any>[]
  createdAt: string; transactionId?: string
}
export const draftOwner = (user: string, company: string) => JSON.stringify([user, company])
export const draftIdentity = (owner: string, key: string) => JSON.stringify([owner, key])
export function newDraftKey() {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('')
}
export function draftPayload(value: any): any {
  if (Array.isArray(value)) return value.map(draftPayload)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, draftPayload(value[key])]))
  return value
}
export const sameDraftPayload = (a: any, b: any) => JSON.stringify(draftPayload(a)) === JSON.stringify(draftPayload(b))

// This synchronous transition also defines which stale callbacks can update a
// stored record. The enclosing IndexedDB readwrite transaction serializes tabs.
export function freezeDraft(row: ManualDraft, payload: Record<string, any>): ManualDraft {
  if (!['draft', 'rejected'].includes(row.state)) return row
  return { ...row, state: 'pending', revision: row.revision + 1, payload: draftPayload(payload),
    previousPayloads: row.payload && !sameDraftPayload(row.payload, payload) ? [...row.previousPayloads, row.payload] : row.previousPayloads }
}
export function settleDraft(row: ManualDraft, revision: number, state: 'saved' | 'deleted' | 'rejected', transactionId?: string): ManualDraft {
  if (row.state === 'deleted' || (state === 'rejected' && (row.revision !== revision || row.state !== 'pending'))) return row
  return { ...row, state, ...(transactionId ? { transactionId } : {}) }
}
export function discardDraft(row: ManualDraft, revision: number): ManualDraft {
  if (row.state !== 'rejected' || row.revision !== revision) return row
  return { ...row, state: 'discarded', revision: row.revision + 1 }
}

async function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) throw Error('Browser draft storage is unavailable')
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('omf-manual-drafts', 1)
    let blocked = false
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('drafts', { keyPath: 'id' })
      store.createIndex('owner', 'owner')
    }
    request.onsuccess = () => {
      const db = request.result
      if (blocked) { db.close(); return }
      db.onversionchange = () => db.close()
      resolve(db)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => { blocked = true; reject(Error('Close the older OMF tab and retry browser storage')) }
  })
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction, value: T, failure: unknown
    try { tx = db.transaction('drafts', mode, { durability: 'strict' }) }
    catch (error) { db.close(); reject(error); return }
    tx.oncomplete = () => { db.close(); resolve(value) }
    tx.onabort = () => { db.close(); reject(failure || tx.error || Error('Browser draft storage was interrupted')) }
    tx.onerror = () => {} // Abort owns the failure and never permits a send.
    try { action(tx.objectStore('drafts'), result => { value = result }) }
    catch (error) { failure = error; tx.abort() }
  })
}
function update(owner: string, key: string, change: (row: ManualDraft) => ManualDraft) {
  return transaction<ManualDraft>('readwrite', (store, result) => {
    const request = store.get(draftIdentity(owner, key))
    request.onsuccess = () => {
      if (!request.result) { request.transaction!.abort(); return }
      const row = change(request.result)
      store.put(row); result(row)
    }
  })
}
export const manualDraftStore = {
  async create(owner: string) {
    const key = newDraftKey(), row: ManualDraft = { id: draftIdentity(owner, key), owner, key, state: 'draft', revision: 0, payload: null, previousPayloads: [], createdAt: new Date().toISOString() }
    return transaction<ManualDraft>('readwrite', (store, result) => { store.add(row); result(row) })
  },
  get(owner: string, key: string) {
    return transaction<ManualDraft | null>('readonly', (store, result) => { const request = store.get(draftIdentity(owner, key)); request.onsuccess = () => result(request.result || null) })
  },
  list(owner: string) {
    return transaction<ManualDraft[]>('readonly', (store, result) => { const request = store.index('owner').getAll(owner); request.onsuccess = () => result(request.result.filter((row: ManualDraft) => ['pending', 'rejected'].includes(row.state))) })
  },
  freeze: (owner: string, key: string, payload: Record<string, any>) => update(owner, key, row => freezeDraft(row, payload)),
  discard: (owner: string, key: string, revision: number) => update(owner, key, row => discardDraft(row, revision)),
  settle: (owner: string, key: string, revision: number, state: 'saved' | 'deleted' | 'rejected', transactionId?: string) => update(owner, key, row => settleDraft(row, revision, state, transactionId))
}
