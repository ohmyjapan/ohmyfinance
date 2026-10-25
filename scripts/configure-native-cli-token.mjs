// Local provisioning of a worker's optional native CLI credential (docs/native-cli-auth.md). Windows only; run on the worker
// machine as the worker's own Windows user while that worker (and the research settings page) is stopped.
//
//   <credential on standard input> | node scripts/configure-native-cli-token.mjs --vault <absolute worker Vault directory> --set
//   node scripts/configure-native-cli-token.mjs --vault <absolute worker Vault directory> --clear
//
// --set reads exactly one line from piped standard input (bounded in size and time; never a console prompt, argument, environment
// variable or file) and stores it as nativeOAuthToken in the existing DPAPI CurrentUser Vault (collector/vault.mjs) with every other
// field unchanged. --clear removes only that field. The Vault must already exist (a configured worker); a missing directory or
// Vault file, a link or junction, an unknown argument or an invalid value is refused without writing. The output is only a status
// line; nothing here reaches a network, a model, a worker restart, pairing or the global CLI login.
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Vault, SealedStore } from '../collector/vault.mjs';
import { NATIVE_CLI_TOKEN_FIELD, validNativeCliToken } from '../shared/finance-native-cli-auth.mjs';
const MAX_BYTES = 8192, STDIN_TIMEOUT_MS = 15000;
const fail = message => { process.stderr.write(JSON.stringify({ error: message }) + '\n'); process.exit(1); };
const failUpdate = error => fail(error?.code === 'locked' ? error.message : 'The worker Vault could not be updated');

function parse(argv) {
  let vault = null, action = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--vault' && vault === null && i + 1 < argv.length) vault = argv[++i];
    else if ((arg === '--set' || arg === '--clear') && action === null) action = arg.slice(2);
    // Never echo an unexpected argument: it may be the credential itself.
    else fail('Unexpected or repeated argument; the credential is accepted only on standard input');
  }
  if (!vault || !action) fail('Usage: --vault <absolute worker Vault directory> (--set with the credential on standard input | --clear)');
  return { vault, action };
}
const normalize = value => path.resolve(value).replace(/^\\\\\?\\/, '').replace(/[\\/]+$/, '').toLowerCase();
async function plain(target, what, kind) {
  let stat;
  try { stat = await lstat(target); } catch (error) { if (error.code === 'ENOENT') fail(what + ' does not exist; configure the worker first'); fail(what + ' cannot be read'); }
  if (stat.isSymbolicLink()) fail(what + ' is a link or junction; give its real path');
  if (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) fail(what + ' is not a ' + kind);
  let real; try { real = await realpath(target); } catch { fail(what + ' cannot be resolved'); }
  if (normalize(real) !== normalize(target)) fail(what + ' resolves elsewhere; give its real path');
}
function readStdin() {
  if (process.stdin.isTTY) fail('Pipe the credential on standard input; it is never read from the console, an argument, the environment or a file');
  return new Promise(resolve => {
    const chunks = []; let size = 0;
    const timer = setTimeout(() => fail('Standard input timed out'), STDIN_TIMEOUT_MS);
    process.stdin.on('data', chunk => { size += chunk.length; if (size > MAX_BYTES) { clearTimeout(timer); fail('The credential on standard input is too long'); } chunks.push(chunk); });
    process.stdin.on('error', () => { clearTimeout(timer); fail('Standard input could not be read'); });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
  });
}
// One line: a single trailing LF or CRLF is removed; anything else (spaces, controls, more lines, non-ASCII) is refused.
const singleLine = bytes => bytes.toString('utf8').replace(/\r?\n$/, '');
const object = current => { if (!current || typeof current !== 'object' || Array.isArray(current)) throw Error('Unexpected Vault content'); return current; };

const { vault: directory, action } = parse(process.argv.slice(2));
if (process.platform !== 'win32') fail('The worker Vault requires Windows');
if (!path.isAbsolute(directory)) fail('Give the absolute worker Vault directory');
const resolved = path.resolve(directory);
await plain(resolved, 'The worker Vault directory', 'directory');
await plain(path.join(resolved, 'credentials.dpapi'), 'The worker Vault file', 'file');
// Reuse the collector's cross-process writer lease for the entire update and read-back.
// Read and validate stdin first so an unfinished pipe cannot hold the writer lease.
const withWriter = fn => new SealedStore(resolved).withLock(fn);
if (action === 'set') {
  const bytes = await readStdin();
  const value = singleLine(bytes);
  bytes.fill(0);
  if (!validNativeCliToken(value)) fail('The credential must be one line of 20-4096 visible ASCII characters');
  try {
    await withWriter(async () => {
      await new Vault(resolved).update(current => ({...object(current),[NATIVE_CLI_TOKEN_FIELD]:value}));
      if ((await new Vault(resolved).read())[NATIVE_CLI_TOKEN_FIELD] !== value) throw Error();
    });
  } catch (error) { failUpdate(error); }
  process.stdout.write(JSON.stringify({nativeOAuthToken:'configured'})+'\n');
} else {
  try {
    await withWriter(async () => {
      await new Vault(resolved).update(current => { const next = { ...object(current) }; delete next[NATIVE_CLI_TOKEN_FIELD]; return next; });
      if (Object.hasOwn(await new Vault(resolved).read(), NATIVE_CLI_TOKEN_FIELD)) throw Error();
    });
  } catch (error) { failUpdate(error); }
  process.stdout.write(JSON.stringify({nativeOAuthToken:'cleared'})+'\n');
}
