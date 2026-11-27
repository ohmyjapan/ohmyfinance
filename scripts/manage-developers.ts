// scripts/manage-developers.ts — the operator's way to list, add and remove developers on the server (plan omf-order-mapping piece 5;
// written after scripts/manage-masters.ts). The app itself never writes the list (server/models/PlatformDeveloper.ts).
//
//   npx tsx scripts/manage-developers.ts list
//   npx tsx scripts/manage-developers.ts add <email or user id> [--note <text>]   [--apply]
//   npx tsx scripts/manage-developers.ts remove <email or user id>                [--apply]
//
// MONGO_URI is required. Dry run by default: add and remove write nothing without --apply. The output carries the user's id, email,
// whether the account is active and whether 2FA is on: the developer routes refuse a developer without 2FA (developerAccess.ts).
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import mongoose from 'mongoose'
import User from '../server/models/User'
import PlatformDeveloper from '../server/models/PlatformDeveloper'

const USAGE = `usage: npx tsx scripts/manage-developers.ts list | add <email or user id> [--note <text>] | remove <email or user id>  [--apply]
  env: MONGO_URI (required). Dry run by default; --apply writes (add, remove).`

async function findUser(who: string): Promise<any> {
  const user = mongoose.isValidObjectId(who) && /^[a-f\d]{24}$/i.test(who)
    ? await User.findById(who).lean()
    : await User.findOne({ email: String(who).trim().toLowerCase() }).lean()
  if (!user) throw new Error(`No user ${who}`)
  return user
}
const describe = (user: any) => `${user._id}\t${user.email}\tactive=${user.isActive !== false ? 'yes' : 'no'}\t2fa=${user.twoFactorEnabled ? 'on' : 'off'}`

export async function runManageDevelopersCli(argv: string[]): Promise<number> {
  const opt = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }, has = (n: string) => argv.includes(n)
  if (has('--help') || argv.length < 1) { console.log(USAGE); return argv.length < 1 ? 2 : 0 }
  if (!process.env.MONGO_URI) { console.error('MONGO_URI is required'); return 2 }
  const command = argv[0], apply = has('--apply'), mode = apply ? 'APPLY ' : 'DRY RUN '
  if (!['list', 'add', 'remove'].includes(command)) { console.error(USAGE); return 2 }
  const who = argv[1]
  if (command !== 'list' && (!who || who.startsWith('--'))) { console.error(USAGE); return 2 }
  await mongoose.connect(process.env.MONGO_URI)
  try {
    if (command === 'list') {
      const rows = await PlatformDeveloper.find().sort({ addedAt: 1 }).lean()
      const users = new Map((await User.find({ _id: { $in: rows.map(r => r.userId) } }).lean()).map((u: any) => [String(u._id), u]))
      for (const row of rows) {
        const user = users.get(String(row.userId))
        console.log(user ? `${describe(user)}\tadded=${row.addedAt.toISOString()}${row.note ? '\t' + row.note : ''}` : `${row.userId}\t(user missing)\tadded=${row.addedAt.toISOString()}`)
      }
      console.log(`${rows.length} developer(s)`)
      return 0
    }
    const user = await findUser(who)
    const listed = await PlatformDeveloper.exists({ userId: user._id })
    if (command === 'add') {
      if (listed) { console.log(`already a developer\t${describe(user)}`); return 0 }
      if (apply) await PlatformDeveloper.create({ userId: user._id, addedAt: new Date(), note: opt('--note') || '' })
      console.log(`${mode}${apply ? 'added' : 'would add'} developer\t${describe(user)}`)
      if (!user.twoFactorEnabled) console.log('note: 2FA is off for this account; the developer routes refuse it until 2FA is on')
      return 0
    }
    if (!listed) { console.log(`not a developer\t${describe(user)}`); return 0 }
    if (apply) await PlatformDeveloper.deleteOne({ userId: user._id })
    console.log(`${mode}${apply ? 'removed' : 'would remove'} developer\t${describe(user)}`)
    return 0
  } finally { await mongoose.disconnect() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runManageDevelopersCli(process.argv.slice(2)).then(code => { process.exitCode = code }, error => { console.error(error?.message || error); process.exitCode = 1 })
