// server/utils/uploadRetention.ts — request-lifetime upload storage (plan omf-security-fixes-20261102 S17). The upload routes
// remove their own input and output in `finally`; a crash between the write and that cleanup can leave a file, which the next
// upload's sweep removes once it is older than the retention. No watcher, no timer: the sweep runs only inside a request.
import { readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export const UPLOAD_RETENTION_MS = 24 * 60 * 60 * 1000

export async function sweepOlderThan(dir: string, maxAgeMs = UPLOAD_RETENTION_MS): Promise<string[]> {
  let names: string[]
  try { names = await readdir(dir) } catch { return [] }
  const cutoff = Date.now() - maxAgeMs
  const removed: string[] = []
  for (const name of names) {
    const target = join(dir, name)
    try {
      const info = await stat(target)
      if (info.isFile() && info.mtimeMs < cutoff) { await unlink(target); removed.push(name) }
    } catch { /* removed by a concurrent request's cleanup */ }
  }
  return removed
}
