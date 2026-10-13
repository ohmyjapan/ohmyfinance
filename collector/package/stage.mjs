// collector/package/stage.mjs — the customer package of the collector (plan omf-customer-credential-security-20261009
// §2 site 7, modelled on cloud-probe/local/drive.mjs stage(); packaged origin per plan omf-customer-connect-20261010).
//   node collector/package/stage.mjs --into <empty dir> --origin https://omf.example [--no-install]
// Copies the customer allowlist (collector/*.mjs, collector/windows/*.ps1, setup.html, setup.js, package.json,
// package-lock.json, shared/amex.mjs — NOT cloud-probe/** (the diagnostic exporter stays out of delivery), NOT
// test/** (fake broker and test hooks stay out)) into an empty folder with a sha256 manifest and the git revision,
// writes collector/omf-config.json with the deployment-supplied HTTPS origin (the address the downloader connects to;
// no secrets; covered by the manifest and catalog), runs `npm ci --omit=dev --ignore-scripts` there, and prints the
// PM2 start line and the explicit setup-launch line. When OMF_SIGNING_CERT names a code-signing certificate
// thumbprint in CurrentUser\My, every *.ps1 is Authenticode-signed and a signed catalog (collector.cat) authenticates
// every staged file including the manifest; otherwise the package is printed as UNSIGNED and recorded as a test
// artifact, never a customer release.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ALLOWLIST = [
  ...['browser','index','interaction','login','mail','run','statement','vault','yayoi','omf-authorization','aplus','aplus-verification'].map(name=>({from:`collector/${name}.mjs`})),
  ...['browser-process','key-broker','private-acl','vault'].map(name=>({from:`collector/windows/${name}.ps1`})),
  { from: 'collector/setup.html' }, { from: 'collector/setup.js' }, { from: 'collector/package.json' }, { from: 'collector/package-lock.json' },
  { from: 'shared/amex.mjs' }, { from: 'shared/aplus.mjs' }, { from: 'shared/finance-pending.mjs' }
];
export const PM2_NAME = 'OhMyFinance-collector';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const psLiteral = value => "'" + String(value).replace(/'/g,"''") + "'";
async function powershell(script) {
  return execute('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,maxBuffer:4*1024*1024});
}

export async function listEntries(repoRoot = REPO_ROOT) {
  return ALLOWLIST.map(item=>({from:item.from,to:item.from}));
}
/** The packaged OMF address: exact HTTPS origin, no path, query, fragment or credentials. */
export function packagedOrigin(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw new Error('--origin <https://omf-host> (or OMF_COLLECTOR_PUBLIC_ORIGIN) is required: the HTTPS address the downloader connects to'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('--origin must be the plain HTTPS origin of OMF, such as https://omf.example');
  return url.origin;
}
export const CONFIG_FILE = 'collector/omf-config.json';
export async function stage({ repoRoot = REPO_ROOT, into = '', origin = process.env.OMF_COLLECTOR_PUBLIC_ORIGIN || '', install = true, signingCert = process.env.OMF_SIGNING_CERT || '', log = console.log } = {}) {
  if (!into) throw new Error('--into <dir> is required');
  into=path.resolve(into);
  const publicOrigin = packagedOrigin(origin);
  if(signingCert && !/^[a-fA-F0-9]{40}$/.test(signingCert))throw new Error('Use the code-signing certificate thumbprint');
  let existing = [];
  try { existing = await readdir(into); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing.length) throw new Error('The staging directory must be empty');
  await mkdir(into, { recursive: true });
  let revision = 'unknown';
  try { revision = (await execute('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { windowsHide: true })).stdout.trim(); } catch { /* not a checkout */ }
  const files = {};
  for (const { from, to } of await listEntries(repoRoot)) {
    const source = path.join(repoRoot, from), target = path.join(into, to);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    files[to] = sha256(await readFile(target));
  }
  // The packaged origin is deployment configuration read by an unconnected downloader; a connected one keeps its saved address.
  const configBytes = JSON.stringify({ origin: publicOrigin, revision, stagedAt: new Date().toISOString() }, null, 2) + '\n';
  await writeFile(path.join(into, CONFIG_FILE), configBytes, { mode: 0o600, flag: 'wx' });
  files[CONFIG_FILE] = sha256(configBytes);
  const manifest = { stagedAt: new Date().toISOString(), revision, origin: publicOrigin, files, signed: false, release: false };
  const collectorDir = path.join(into, 'collector');
  if (install) {
    await execute('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', [], { cwd: collectorDir, windowsHide: true, shell: true, maxBuffer: 16 * 1024 * 1024 });
    manifest.installed = true;
  }
  let signing = { signed: false, catalog: 'collector.cat', note: 'no OMF_SIGNING_CERT; test artifact, not a customer release' };
  const certLookup=`$cert = Get-ChildItem Cert:\\CurrentUser\\My -CodeSigningCert | Where-Object { $_.Thumbprint -eq ${psLiteral(signingCert)} }; if (-not $cert) { throw 'certificate not found' };`;
  if (signingCert) {
    await powershell(`$ErrorActionPreference='Stop'; ${certLookup} Get-ChildItem -LiteralPath ${psLiteral(path.join(collectorDir,'windows'))} -Filter *.ps1 | ForEach-Object { $s = Set-AuthenticodeSignature -FilePath $_.FullName -Certificate $cert -HashAlgorithm SHA256; if ($s.Status -ne 'Valid') { throw ('signature ' + $s.Status + ' on ' + $_.Name) } }`);
    signing = { signed: true, catalog: 'collector.cat', note: 'signed scripts and catalog; release only after the independent review and the acceptance matrix' };
    manifest.signed = true;
    // Authenticode changes script bytes. Hash the installed bytes, not the unsigned inputs.
    for(const file of Object.keys(files))files[file]=sha256(await readFile(path.join(into,file)));
  }
  await writeFile(path.join(into, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await writeFile(path.join(into, 'RELEASE-STATUS.txt'), `${signing.signed ? 'SIGNED' : 'UNSIGNED'} — ${signing.note}\nrevision ${revision}\nOMF address ${publicOrigin}\nstart: pm2 start ${path.join(into, 'collector', 'run.mjs')} --name ${PM2_NAME}\nopen setup: node ${path.join(into, 'collector', 'run.mjs')} --open-setup\n`, { mode: 0o600, flag: 'wx' });
  // Finalize metadata before catalog creation. No covered file is changed afterward.
  const catalog=psLiteral(path.join(into,'collector.cat')), staged=psLiteral(into);
  await powershell(`$ErrorActionPreference='Stop'; New-FileCatalog -Path ${staged} -CatalogFilePath ${catalog} -CatalogVersion 2.0 | Out-Null; ${signingCert ? `${certLookup} $s=Set-AuthenticodeSignature -FilePath ${catalog} -Certificate $cert -HashAlgorithm SHA256; if($s.Status -ne 'Valid'){throw ('catalog signature '+$s.Status)};` : ''} $v=Test-FileCatalog -Path ${staged} -CatalogFilePath ${catalog} -FilesToSkip 'collector.cat'; if($v -ne 'Valid'){throw ('catalog '+$v)}`);
  log(`staged ${Object.keys(files).length} files at ${revision} for ${publicOrigin} into ${into}${install ? ' (dependencies installed from the lock)' : ''}`);
  log(`${signing.signed ? 'SIGNED' : 'UNSIGNED'}: ${signing.note}`);
  log(`pm2 start ${path.join(into, 'collector', 'run.mjs')} --name ${PM2_NAME}`);
  log(`open setup: node ${path.join(into, 'collector', 'run.mjs')} --open-setup`);
  return { manifest, signing, into, origin: publicOrigin };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), index = args.indexOf('--into'), originIndex = args.indexOf('--origin');
  stage({ into: index >= 0 ? args[index + 1] : '', origin: originIndex >= 0 ? args[originIndex + 1] : process.env.OMF_COLLECTOR_PUBLIC_ORIGIN || '', install: !args.includes('--no-install') }).then(() => { process.exitCode = 0; }, error => { console.error(error.message); process.exitCode = 1; });
}
