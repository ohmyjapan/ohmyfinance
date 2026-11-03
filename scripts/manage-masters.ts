// scripts/manage-masters.ts — the operator's way to list, add, edit, delete and seed the shared masters on the server
// (plan omf-security-fixes-20261102 S20; the app refuses every in-app write, server/utils/sharedMasterAccess.ts).
//
//   npx tsx scripts/manage-masters.ts <kind> list [--search <text>]
//   npx tsx scripts/manage-masters.ts <kind> create --json '<fields>'        [--apply]
//   npx tsx scripts/manage-masters.ts <kind> set <id> --json '<fields>'      [--apply]
//   npx tsx scripts/manage-masters.ts <kind> delete <id>                     [--apply]
//   npx tsx scripts/manage-masters.ts <kind> seed                            [--apply]
//
// kind: account-category | tax-category | transaction-category | category | template. MONGO_URI is required. Dry run by default:
// create, set, delete and seed write nothing without --apply. Only each kind's whitelisted fields are written (a `$`-operator,
// organizationId or companyRegistrations in --json is ignored); the output carries id, name and code only — never a registration.
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import mongoose from 'mongoose'
import { MASTER_KINDS, masterKind, listMasters, createMaster, updateMaster, deleteMaster, seedMasters } from '../server/utils/masterMaintenance'

const USAGE = `usage: npx tsx scripts/manage-masters.ts <kind> list [--search <text>] | create --json '<fields>' | set <id> --json '<fields>' | delete <id> | seed  [--apply]
  kind: ${Object.keys(MASTER_KINDS).join(' | ')}
  env: MONGO_URI (required). Dry run by default; --apply writes (create, set, delete and seed).`

const printRow = (prefix: string, row: { id: string; name: string; code?: string }) => console.log(`${prefix}${row.id}\t${row.name}${row.code ? '\t' + row.code : ''}`)

export async function runManageMastersCli(argv: string[]): Promise<number> {
  const opt = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }, has = (n: string) => argv.includes(n)
  if (has('--help') || argv.length < 2) { console.log(USAGE); return argv.length < 2 ? 2 : 0 }
  if (!process.env.MONGO_URI) { console.error('MONGO_URI is required'); return 2 }
  let kind: ReturnType<typeof masterKind>
  try { kind = masterKind(argv[0]) } catch (error: any) { console.error(error.message); return 2 }
  const command = argv[1], apply = has('--apply')
  const parseJson = () => { const raw = opt('--json'); if (!raw) throw new Error('--json <fields> is required'); return JSON.parse(raw) }
  const mode = apply ? 'APPLY ' : 'DRY RUN '
  await mongoose.connect(process.env.MONGO_URI)
  try {
    if (command === 'list') {
      const rows = await listMasters(kind, opt('--search'))
      for (const row of rows) printRow('', row)
      console.log(`${rows.length} ${kind} row(s)`)
      return 0
    }
    if (command === 'create') {
      const result = await createMaster(kind, parseJson(), { apply })
      if (result.dryRun) printRow(`${mode}create ${kind} `, { id: '', name: String(result.values?.name ?? ''), ...(result.values?.code ? { code: String(result.values.code) } : {}) })
      else printRow(`${mode}created ${kind} `, result.row!)
      return 0
    }
    if (command === 'set') {
      const id = argv[2]
      if (!id || id.startsWith('--')) { console.error(USAGE); return 2 }
      const result = await updateMaster(kind, id, parseJson(), { apply })
      printRow(`${mode}set ${kind} `, result.row)
      return 0
    }
    if (command === 'delete') {
      const id = argv[2]
      if (!id || id.startsWith('--')) { console.error(USAGE); return 2 }
      const result = await deleteMaster(kind, id, { apply })
      printRow(`${mode}${result.dryRun ? 'would delete' : 'deleted'} ${kind} `, result.row)
      return 0
    }
    if (command === 'seed') {
      const result = await seedMasters({ apply })
      console.log(`${mode}seed ${JSON.stringify(result.results)}`)
      return 0
    }
    console.error(USAGE)
    return 2
  } finally { await mongoose.disconnect() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runManageMastersCli(process.argv.slice(2)).then(code => { process.exitCode = code }, error => { console.error(error?.message || error); process.exitCode = 1 })
