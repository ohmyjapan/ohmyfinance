import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const timeoutMs = 1200000;
const marker = '6 Organization settings groups passed';
export default { name: 'omf-organization-settings', covers: ['pages/settings/organization.vue', 'docs/navi-company-workspace.md', 'scripts/finance-organization-settings-integration.cjs', 'scripts/zoomer-fixtures/omf-organization-settings.mjs'], async run() {
  const run = app => new Promise(resolve => execFile(process.execPath, [path.join(root, 'scripts/finance-organization-settings-integration.cjs')], { cwd: root, windowsHide: true, env: { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '', OMF_SETTINGS_APP_ROOT: app }, timeout: 300000, maxBuffer: 3 * 1024 * 1024 }, (e, stdout, stderr) => resolve({ code: e ? e.code ?? 1 : 0, text: stdout + stderr })));
  const result = await run(root), controls = [], mutants = []; let pass = result.code === 0 && result.text.includes(marker);
  if (pass) {
    const base = path.resolve(root, '.zoomer/organization-settings-mutants'), directory = path.resolve(base, randomUUID());
    if (!directory.startsWith(base + path.sep)) throw Error('Unsafe owned fixture directory'); await mkdir(directory, { recursive: true });
    try {
      await cp(path.join(root, '.output'), path.join(directory, '.output'), { recursive: true, dereference: true });
      const copied = await run(directory); controls.push({ name: 'unchanged-packaged-copy', pass: copied.code === 0 && copied.text.includes(marker), ...copied });
      if (!controls[0].pass) throw Error('Packaged positive must pass before defects');
      const candidates = [], walk = async dir => { for (const e of await readdir(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) await walk(p); else if (p.endsWith('.js')) { const s = await readFile(p, 'utf8'); if (s.includes('Failed to save:') && s.includes('sessionId')) candidates.push({ p, s }); } } };
      await walk(path.join(directory, '.output/public/_nuxt'));
      if (candidates.length !== 1) throw Error('Expected one actual settings client chunk, found ' + candidates.length);
      const { p, s } = candidates[0], pattern = /[A-Za-z_$][\w$]*\.sessionId\s*===\s*[A-Za-z_$][\w$]*/g, matches = [...s.matchAll(pattern)];
      if (matches.length !== 1) throw Error('Expected one actual compiled save-session comparison, found ' + matches.length);
      // Nitro retains the original static asset's content-length. Keep that length
      // so the browser executes the deliberate defect rather than a truncated module.
      await writeFile(p, s.replace(pattern, match => 'true'.padEnd(match.length, ' ')));
      const defect = await run(directory), detected = defect.code !== 0 && defect.text.includes('AssertionError') && defect.text.includes('settings:stale-actor-shared-role');
      mutants.push({ name: 'late-save-ignores-actor-session', detected, ...defect }); pass = pass && detected;
    } catch (e) { pass = false; mutants.push({ setupError: String(e.message), detected: false }); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
  return { pass: pass && controls.length === 1 && mutants.length === 1, databaseCoverage: { executed: result.code === 0, ownedProcess: result.code === 0 }, message: JSON.stringify({ result, controls, mutants, limits: 'Six actual settings/transaction/CSV installed-Chrome groups on an owned database, unchanged packaged control, one meaningful compiled-client session-guard defect. No model, provider or production data. Independent review, privacy-safe real-case replay and deployment remain separate.' }) };
} };
