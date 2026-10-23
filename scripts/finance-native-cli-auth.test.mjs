// Optional native CLI credential delivery (docs/native-cli-auth.md): the five actual native CLI callers, the teaching worker
// entrypoint and the local provisioning command, exercised with real Node children at the spawn seam and a real Windows DPAPI
// Vault in an owned temporary directory. No provider, model, OMF server, bank, mail, Slack or real Vault is reached: the native
// CLI is replaced only at child_process.spawn by an owned Node stand-in that records what the caller handed it (the credential
// only as a SHA-256 digest, the environment only as names and one digest) and returns a synthetic reply. Every credential here is
// generated at random for this run. OMF_NATIVE_AUTH_TEST_ROOT selects a copied source tree (the fixture's control and mutants).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(process.env.OMF_NATIVE_AUTH_TEST_ROOT || repo);
const KEY = 'CLAUDE_CODE_OAUTH_TOKEN';
const sha = value => createHash('sha256').update(value).digest('hex');
const tag = name => 'native-auth:' + name;
const prefix = path.join(path.resolve(os.tmpdir()), 'omf-native-auth-');
const owned = await fs.mkdtemp(prefix);
const inside = target => { const r = path.resolve(target); return r === owned || r.startsWith(owned + path.sep); };

// Synthetic, run-local values only.
const tokenA = 'synthetic-native-a-' + randomBytes(24).toString('hex');
const tokenB = 'synthetic-native-b-' + randomBytes(24).toString('hex');
const ambient = 'synthetic-ambient-' + randomBytes(24).toString('hex');
const serverToken = 'omft_' + randomBytes(32).toString('hex');
const unicode = '会社用です。 한국어 응답입니다. 🚀';

// The review worker inherits the ambient environment (its existing default); the four allowlisted callers do not. One ambient
// credential and one ambient probe make that difference observable without reading any real environment value.
const savedAmbient = { [KEY]: process.env[KEY], OMF_NATIVE_AUTH_AMBIENT_PROBE: process.env.OMF_NATIVE_AUTH_AMBIENT_PROBE };
process.env[KEY] = ambient;
process.env.OMF_NATIVE_AUTH_AMBIENT_PROBE = 'ambient-probe';

const standin = path.join(owned, 'standin.cjs');
const intercept = path.join(owned, 'intercept.mjs');
const marker = path.join(owned, 'native-cli-standin.exe');
await fs.writeFile(standin, String.raw`
const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const [scenarioFile,...args]=process.argv.slice(2);
const s=JSON.parse(fs.readFileSync(scenarioFile,'utf8'));
const KEY='CLAUDE_CODE_OAUTH_TOKEN',token=process.env[KEY];
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const scan=(dir,needle)=>{let found=false;const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())walk(f);else if(e.isFile()&&fs.readFileSync(f).includes(needle))found=true}};try{walk(dir)}catch{}return found};
let stdin='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>stdin+=c);
process.stdin.on('end',()=>{
 const env={...process.env};delete env[KEY];
 const names=Object.keys(env).sort();
 let mcp=null;const at=args.indexOf('--mcp-config');try{mcp=JSON.parse(args[at+1])}catch{}
 const servers=[];
 for(const [name,server] of Object.entries((mcp&&mcp.mcpServers)||{})){
  const serverEnv=server.env||{};
  // Worst case for the tools child: it inherits this CLI environment and the configured server env is laid over it.
  const probe=cp.spawnSync(process.execPath,['-e',"const v=process.env.CLAUDE_CODE_OAUTH_TOKEN;process.stdout.write(JSON.stringify({present:v!==undefined,empty:v==='',sha:v?require('crypto').createHash('sha256').update(v).digest('hex'):''}))"],{env:{...process.env,...serverEnv},encoding:'utf8',windowsHide:true});
  const jobFile=serverEnv.OMF_ACTIONS_JOB_FILE||serverEnv.OMF_RESEARCH_JOB_FILE||'';
  const has=Object.prototype.hasOwnProperty.call(serverEnv,KEY);
  servers.push({name,envKeys:Object.keys(serverEnv).sort(),envAuth:has?(serverEnv[KEY]===''?'blank':serverEnv[KEY]===token?'token':'other'):'absent',probe:JSON.parse(probe.stdout||'null'),jobFileExists:!!jobFile&&fs.existsSync(jobFile),jobDirLeak:!!token&&!!jobFile&&scan(path.dirname(jobFile),token)});
 }
 const record={pid:process.pid,args,cwd:process.cwd(),envNames:names,envDigest:sha(JSON.stringify(names.map(k=>[k,String(env[k]).replace(/jobs[\\/][0-9a-f-]{36}/g,'jobs/<id>')]))),ambientProbe:env.OMF_NATIVE_AUTH_AMBIENT_PROBE||'',configDir:env.CLAUDE_CONFIG_DIR||'',traffic:env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC||'',auth:token===undefined?{present:false}:{present:true,sha:sha(token)},argsHaveToken:!!token&&args.some(a=>a.includes(token)),stdinHasToken:!!token&&stdin.includes(token),stdin,servers};
 fs.mkdirSync(s.records,{recursive:true});
 fs.writeFileSync(path.join(s.records,process.pid+'-'+crypto.randomBytes(4).toString('hex')+'.json'),JSON.stringify(record));
 if(s.mode==='hang'){setInterval(()=>{},1000);return}
 if(s.mode==='fail'){process.stderr.write('synthetic native failure');process.exitCode=3;return}
 const schemaAt=args.indexOf('--json-schema');let schema={};try{schema=JSON.parse(args[schemaAt+1])}catch{}
 const turns=args[args.indexOf('--max-turns')+1];
 let reply;
 if(args.includes('--input-format'))reply={complete:false,pages:[],records:[]};
 else if(schema.properties&&schema.properties.findings)reply=turns==='24'?{summary:'Synthetic',question:'',supplier:null,findings:[{field:'purpose',valueJson:'"business"',reason:'Synthetic',basis:'reasoned',citations:[{sourceId:'s0',quote:'Heroku'}]}]}:{summary:'Synthetic',question:'',supplier:null,findings:[]};
 else reply={kind:'unclear',summary:s.summary,patch:{},quotes:{}};
 if(args.includes('--input-format'))process.stdout.write(JSON.stringify({type:'system'})+'\n'+JSON.stringify({type:'result',is_error:false,structured_output:reply,modelUsage:{'synthetic-standin':{}}})+'\n');
 else process.stdout.write(JSON.stringify({is_error:false,structured_output:reply,modelUsage:{'synthetic-standin':{}}}));
});
`);
await fs.writeFile(intercept, `
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const nativeSpawn = cp.spawn;
const preset = JSON.parse(process.env.OMF_NATIVE_AUTH_STANDIN || 'null');
let marker = preset?.marker || null, standin = preset?.standin || null, scenario = preset?.scenario || null, counter = 0;
export const spawned = [];
export function configure(m, s) { marker = m; standin = s; }
export function setScenario(value) { scenario = value; }
cp.spawn = function (command, args, options) {
  if (!marker || command !== marker) return nativeSpawn.apply(this, arguments);
  if (!scenario) throw Error('native-auth:setup:no-scenario');
  const file = path.join(path.dirname(standin), 'scenarios', process.pid + '-' + (++counter) + '.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(scenario));
  const child = nativeSpawn(process.execPath, [standin, file, ...args], options);
  spawned.push(child.pid);
  return child;
};
syncBuiltinESMExports();
`);
const seam = await import(pathToFileURL(intercept).href);
seam.configure(marker, standin);

const load = async file => import(pathToFileURL(path.join(root, file)).href);
const { interpretChat } = await load('teaching-worker/interpreter.mjs');
const { interpretDocument } = await load('teaching-worker/document-interpreter.mjs');
const { ResearchWorker } = await load('research-worker/worker.mjs');
const { interpretReply } = await load('review-worker/interpreter.mjs');
const { interpret: interpretWorkflow } = await load('finalization-worker/interpreter.mjs');
const { Vault } = await load('collector/vault.mjs');
const { emptyValues } = await load('shared/finance-draft.mjs');
const helperFile = path.join(root, 'shared/finance-native-cli-auth.mjs');
const configureScript = path.join(root, 'scripts/configure-native-cli-token.mjs');

let sequence = 0;
async function scenario(mode = 'ok') {
  const records = path.join(owned, 'records', String(++sequence));
  await fs.mkdir(records, { recursive: true });
  seam.setScenario({ mode, records, summary: unicode });
  return records;
}
async function records(dir) {
  const out = [];
  for (const name of existsSync(dir) ? readdirSync(dir) : []) out.push(JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')));
  return out;
}
async function freshDir(name) { const d = path.join(owned, name + '-' + (++sequence)); await fs.mkdir(d, { recursive: true }); return d; }
const inference = await freshDir('inference');
const profile = path.join(owned, 'profile-directory-unused');
const base = async extra => ({ cliPath: marker, inferenceDirectory: inference, directory: await freshDir('worker'), baseUrl: 'http://127.0.0.1:9/', token: serverToken, claudeConfigDirectory: profile, ...extra });
const workspaceJob = (text = unicode) => ({ text, context: { mode: 'workspace', pageName: 'Synthetic', facts: {}, capabilities: [], messages: [] } });
const toolJob = (text = unicode) => ({ ...workspaceJob(text), mode: 'workspace', tools: [{ name: 'get_draft', description: 'Synthetic', inputSchema: { type: 'object', properties: {} } }], actionEndpoint: 'http://127.0.0.1:9/api/finance-chat/worker/workspace/' + 'a'.repeat(24) + '/actions', lease: 'synthetic-lease', nextSlot: 1 });
const review = () => ({ context: { study: { question: '用途は?' }, values: { purpose: '', customerId: '' }, customers: [] }, proposal: null, replies: [] });
const png = Buffer.from('synthetic-document-' + unicode, 'utf8');
const researchContext = () => { const source = { kind: 'expense', description: 'Heroku* synthetic', purchaseDate: '2026-04-01', amount: 4200, account: { id: '0'.repeat(23) + '1', name: 'Synthetic card' } }; return { source, values: { ...emptyValues(source), purpose: 'company' }, references: { accountCategories: [] } }; };

// A local stand-in for the OMF research API on 127.0.0.1: one claimable job, progress and result routes. It records every
// Authorization header and body so the OMF server bearer is shown distinct from the native credential.
async function researchApi(job) {
  const seen = { auth: new Set(), bodies: [], result: null };
  let claimed = false;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    seen.auth.add(req.headers.authorization); seen.bodies.push(body);
    const route = req.url.replace('/api/finance-research/worker/', '');
    let answer = {};
    if (route === 'claim') { answer = { job: claimed ? null : job }; claimed = true; }
    else if (route === 'evaluation/claim' || route === 'intake/claim') answer = { job: null };
    else if (route.endsWith('/result')) { seen.result = JSON.parse(body); answer = { success: true }; }
    res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' }); res.end(JSON.stringify(answer));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { origin: 'http://127.0.0.1:' + server.address().port + '/', seen, close: () => new Promise(r => server.close(r)) };
}
async function runResearch(extra, jobExtra = {}, reuse = null) {
  const context = researchContext(), text = JSON.stringify(context);
  const proof = { id: 's0', kind: 'context', text, title: 'Synthetic context', url: '', hash: sha(text), capturedAt: new Date().toISOString() };
  const job = { id: 'synthetic-job', mode: 'research', lease: 'synthetic-lease', context, sources: [proof], instruction: unicode, ...jobExtra };
  const api = await researchApi(job);
  const directory = reuse || await freshDir('research');
  try {
    const worker = new ResearchWorker({ ...(await base()), directory: undefined, baseUrl: api.origin, ...extra }, directory, { log: () => {} });
    const handled = await worker.cycle();
    return { handled, api, directory };
  } finally { await api.close(); }
}

const callers = {
  teaching: async (config, job = workspaceJob()) => interpretChat(config, job),
  'teaching-mcp': async (config, job = toolJob()) => interpretChat(config, job),
  document: async (config, document = { mimeType: 'image/png' }) => interpretDocument(config, document, png),
  review: async (config, item = review()) => interpretReply(config, item, unicode),
  finalization: async (config, input = { marker: unicode }) => interpretWorkflow(config, { system: 'Synthetic', schema: { type: 'object' }, input }, 20000),
};
const allowlisted = ['teaching', 'teaching-mcp', 'document', 'finalization'];
const normalizeArgs = args => args.map((a, i) => {
  if (args[i - 1] !== '--mcp-config') return a;
  const parsed = JSON.parse(a);
  for (const server of Object.values(parsed.mcpServers || {})) { if (server.env) { delete server.env[KEY]; for (const k of Object.keys(server.env)) server.env[k] = String(server.env[k]).replace(/jobs[\\/][0-9a-f-]{36}/g, 'jobs/<id>'); } }
  return JSON.stringify(parsed);
});
const envSnapshot = () => JSON.stringify(Object.entries(process.env).sort());

test('default: an absent credential keeps every caller environment, argument and the review worker ambient inheritance', async () => {
  for (const [name, call] of Object.entries(callers)) {
    const dir = await scenario();
    await call(await base());
    const [r] = await records(dir);
    assert.ok(r, tag('setup:no-child-' + name));
    if (allowlisted.includes(name)) {
      assert.equal(r.auth.present, false, tag('default-' + name + ' allowlisted child has no native credential'));
      assert.equal(r.ambientProbe, '', tag('default-' + name + ' allowlist preserved'));
    } else {
      assert.equal(r.auth.sha, sha(ambient), tag('review-ambient-inherited (unchanged default, not a security fix)'));
      assert.equal(r.ambientProbe, 'ambient-probe', tag('review-ambient-inherited'));
    }
    assert.equal(r.traffic, '1', tag('default-' + name + ' traffic switch'));
    assert.equal(r.cwd.toLowerCase(), inference.toLowerCase(), tag('default-' + name + ' cwd'));
  }
});

test('configured: the explicit credential reaches the native CLI child only; environment, arguments and input are otherwise identical', async () => {
  for (const [name, call] of Object.entries(callers)) {
    const before = envSnapshot();
    const plain = await scenario(); const shared = await base();
    const defaultResult = await call(shared);
    const configured = await scenario();
    const result = await call({ ...shared, nativeOAuthToken: tokenA });
    const [d] = await records(plain), [c] = await records(configured);
    assert.ok(d && c, tag('setup:no-child-' + name));
    assert.equal(c.auth.present && c.auth.sha, sha(tokenA), tag('configured-' + name + ' child did not receive the configured native credential'));
    assert.deepEqual(c.envNames, d.envNames, tag('env-unchanged-' + name));
    assert.equal(c.envDigest, d.envDigest, tag('env-unchanged-' + name));
    assert.deepEqual(normalizeArgs(c.args), normalizeArgs(d.args), tag('args-unchanged-' + name + ' (model, effort, schema, tools, turns)'));
    assert.equal(c.stdin, d.stdin, tag('input-unchanged-' + name));
    assert.equal(c.argsHaveToken || c.stdinHasToken, false, tag('no-arg-input-leak-' + name));
    assert.deepEqual(result, defaultResult, tag('result-unchanged-' + name));
    assert.equal(envSnapshot(), before, tag('process-env-unchanged-' + name));
    assert.equal(JSON.stringify(result).includes(tokenA), false, tag('result-no-leak-' + name));
  }
  // Exact Unicode input and reply through the actual teaching caller.
  const dir = await scenario();
  const reply = await callers.teaching({ ...(await base()), nativeOAuthToken: tokenA }, workspaceJob(unicode + ' 質問'));
  assert.equal(reply.summary, unicode, tag('unicode-reply'));
  const [r] = await records(dir);
  assert.equal(JSON.parse(r.stdin).currentMessage, unicode + ' 質問', tag('unicode-input'));
});

test('configured review worker: the configured credential replaces the ambient one; the rest of the inherited environment is unchanged', async () => {
  const dir = await scenario();
  await callers.review({ ...(await base()), nativeOAuthToken: tokenB });
  const [r] = await records(dir);
  assert.equal(r.auth.sha, sha(tokenB), tag('configured-review-over-ambient'));
  assert.equal(r.ambientProbe, 'ambient-probe', tag('review-ambient-inherited'));
  assert.equal(process.env[KEY], ambient, tag('process-env-unchanged-review'));
});

test('MCP tools children get an explicit blank credential; job files carry none; the default MCP environment is unchanged', async () => {
  const configured = await scenario();
  await callers['teaching-mcp']({ ...(await base()), nativeOAuthToken: tokenA });
  const [c] = await records(configured);
  assert.equal(c.servers.length, 1, tag('setup:mcp-config-missing'));
  assert.equal(c.servers[0].envAuth, 'blank', tag('mcp-blank-teaching'));
  assert.notEqual(c.servers[0].probe.sha, sha(tokenA), tag('mcp-probe-teaching'));
  assert.equal(c.servers[0].jobFileExists, true, tag('setup:job-file-missing'));
  assert.equal(c.servers[0].jobDirLeak, false, tag('job-file-no-leak-teaching'));
  const plain = await scenario();
  await callers['teaching-mcp'](await base());
  const [d] = await records(plain);
  assert.equal(d.servers[0].envAuth, 'absent', tag('mcp-default-unchanged'));
});

test('research: initial and correction native calls share the configured credential; MCP blank; OMF bearer distinct; implementation hash includes the helper', async () => {
  const turns = r => r.args[r.args.indexOf('--max-turns') + 1];
  const plainDir = await scenario();
  const plain = await runResearch({});
  const shared = plain.directory;
  const configuredDir = await scenario();
  const { handled, api } = await runResearch({ nativeOAuthToken: tokenA }, {}, shared);
  assert.equal(handled, true, tag('setup:research-cycle'));
  const legs = await records(configuredDir), plainLegs = await records(plainDir);
  assert.deepEqual(legs.map(turns).sort(), ['24', '3'], tag('setup:research-legs (initial and correction)'));
  assert.deepEqual(plainLegs.map(turns).sort(), ['24', '3'], tag('setup:research-legs (initial and correction)'));
  for (const leg of plainLegs) assert.equal(leg.auth.present, false, tag('default-research'));
  for (const leg of legs) {
    assert.equal(leg.auth.present && leg.auth.sha, sha(tokenA), tag('configured-research leg ' + turns(leg) + ' did not receive the configured native credential'));
    const twin = plainLegs.find(p => turns(p) === turns(leg));
    assert.deepEqual(leg.envNames, twin.envNames, tag('env-unchanged-research'));
    assert.equal(leg.envDigest, twin.envDigest, tag('env-unchanged-research'));
    assert.deepEqual(normalizeArgs(leg.args), normalizeArgs(twin.args), tag('args-unchanged-research'));
    assert.equal(leg.argsHaveToken || leg.stdinHasToken, false, tag('no-arg-input-leak-research'));
  }
  const initial = legs.find(l => turns(l) === '24'), plainInitial = plainLegs.find(l => turns(l) === '24');
  assert.equal(initial.servers.length, 1, tag('setup:mcp-config-missing'));
  assert.equal(initial.servers[0].envAuth, 'blank', tag('mcp-blank-research'));
  assert.notEqual(initial.servers[0].probe.sha, sha(tokenA), tag('mcp-probe-research'));
  assert.equal(initial.servers[0].jobDirLeak, false, tag('job-file-no-leak-research'));
  assert.equal(plainInitial.servers[0].envAuth, 'absent', tag('mcp-default-unchanged-research'));
  assert.ok(api.seen.result && api.seen.result.failed === undefined && api.seen.result.report, tag('research-result-delivered'));
  assert.deepEqual([...api.seen.auth], ['Bearer ' + serverToken], tag('server-token-distinct'));
  assert.equal(api.seen.bodies.some(b => b.includes(tokenA)), false, tag('api-no-leak'));
  assert.equal(api.seen.result.runtime.models.includes('synthetic-standin'), true, tag('research-runtime'));
});

test('research runtime implementation hash includes the imported credential helper', async () => {
  assert.ok(existsSync(helperFile), tag('setup:helper-missing'));
  const dir = await scenario(); void dir;
  const { api } = await runResearch({ nativeOAuthToken: tokenA });
  const h = createHash('sha256');
  for (const file of ['./worker.mjs', './tools.mjs', './sheets.mjs', './sheet-export.mjs', './issey-archive.mjs', './search-evidence.mjs', './search-review.mjs', './accounting-guidance.mjs', './question-guidance.mjs', './evidence-repair.mjs', '../shared/finance-accounting-assessment.mjs', '../shared/finance-accountant-role.mjs', './mcp.mjs', '../shared/finance-research.mjs', '../shared/finance-draft.mjs', '../shared/finance-native-cli-auth.mjs']) h.update(readFileSync(path.join(root, 'research-worker', file)));
  assert.equal(api.seen.result.runtime.implementationHash, h.digest('hex'), tag('research-hash-includes-helper'));
});

test('untrusted job, document, review and workflow fields cannot select or override the native credential', async () => {
  // A job-supplied look-alike value: job data, never the configured credential (the leak scan below looks for tokenA/tokenB).
  const smuggled = 'synthetic-smuggled-' + randomBytes(24).toString('hex');
  const smuggle = { nativeOAuthToken: smuggled, [KEY]: smuggled, env: { [KEY]: smuggled }, cliPath: 'synthetic-other.exe' };
  const cases = [
    ['teaching-mcp', () => ({ ...toolJob(), ...smuggle })],
    ['document', () => ({ mimeType: 'image/png', ...smuggle })],
    ['review', () => ({ ...review(), ...smuggle, context: { ...review().context, ...smuggle } })],
    ['finalization', () => ({ marker: unicode, ...smuggle })],
  ];
  for (const [name, item] of cases) {
    for (const [label, extra, expected] of [['absent', {}, null], ['configured', { nativeOAuthToken: tokenA }, sha(tokenA)]]) {
      const dir = await scenario();
      await callers[name](await base(extra), item());
      const [r] = await records(dir);
      assert.ok(r, tag('setup:no-child-' + name));
      assert.notEqual(r.auth.sha, sha(smuggled), tag('job-override-' + name + '-' + label));
      if (expected) assert.equal(r.auth.sha, expected, tag('job-override-' + name + '-' + label));
      else if (name === 'review') assert.equal(r.auth.sha, sha(ambient), tag('job-override-' + name + '-' + label));
      else assert.equal(r.auth.present, false, tag('job-override-' + name + '-' + label));
    }
  }
  for (const [label, extra, expected] of [['absent', {}, null], ['configured', { nativeOAuthToken: tokenA }, sha(tokenA)]]) {
    const dir = await scenario();
    await runResearch(extra, smuggle);
    for (const leg of await records(dir)) assert.equal(leg.auth.present ? leg.auth.sha : null, expected, tag('job-override-research-' + label));
  }
});

test('invalid explicit configuration fails closed before any native child starts and never names the value', async () => {
  const invalid = ['', null, 42, true, 'short-token', 'synthetic native with space ' + 'b'.repeat(24), 'synthetic-native-line\n' + 'c'.repeat(24), 'x'.repeat(4097), 'あ'.repeat(30), { value: tokenA }, [tokenA]];
  for (const [name, call] of Object.entries(callers)) {
    for (const value of invalid) {
      const dir = await scenario();
      await assert.rejects(call(await base({ nativeOAuthToken: value })), error => {
        if (typeof value === 'string' && value.length > 3) assert.equal(String(error.message).includes(value), false, tag('invalid-error-no-leak-' + name));
        assert.equal(String(error.message).includes(tokenA), false, tag('invalid-error-no-leak-' + name));
        return true;
      }, tag('invalid-fails-closed-' + name + ' accepted ' + JSON.stringify(typeof value)));
      assert.equal((await records(dir)).length, 0, tag('invalid-no-child-' + name));
    }
    const dir = await scenario();
    await call(await base({ nativeOAuthToken: undefined }));
    const [r] = await records(dir);
    assert.equal(name === 'review' ? r.auth.sha : r.auth.present, name === 'review' ? sha(ambient) : false, tag('undefined-is-absent-' + name));
  }
  for (const value of ['short-token', null]) {
    const dir = await scenario();
    const { handled, api } = await runResearch({ nativeOAuthToken: value });
    assert.equal(handled, true, tag('setup:research-cycle'));
    assert.equal(api.seen.result?.failed, true, tag('invalid-fails-closed-research'));
    assert.equal((await records(dir)).length, 0, tag('invalid-no-child-research'));
    assert.equal(api.seen.bodies.some(b => b.includes('short-token')), false, tag('invalid-error-no-leak-research'));
  }
});

async function gone(pid) {
  for (let i = 0; i < 50; i++) { try { process.kill(pid, 0); } catch { return true; } await new Promise(r => setTimeout(r, 100)); }
  return false;
}
test('child failure, timeout and unavailable CLI: errors carry no credential, children are gone and no job residue remains', async () => {
  const cfg = await base({ nativeOAuthToken: tokenA });
  for (const [name, message] of [['teaching-mcp', 'Teaching interpreter failed'], ['document', 'Document interpreter failed'], ['review', 'Reply interpreter failed'], ['finalization', 'Workflow interpreter failed']]) {
    const dir = await scenario('fail');
    await assert.rejects(callers[name](cfg), error => error.message === message && !error.message.includes(tokenA), tag('failure-' + name));
    const [r] = await records(dir);
    assert.equal(r.auth.sha, sha(tokenA), tag('configured-' + name + ' failing child'));
    assert.ok(await gone(r.pid), tag('failure-child-gone-' + name));
  }
  assert.deepEqual(readdirSync(path.join(cfg.directory, 'jobs')), [], tag('cleanup-jobs'));
  const hang = await scenario('hang');
  await assert.rejects(interpretWorkflow(cfg, { system: 'Synthetic', schema: { type: 'object' }, input: { marker: unicode } }, 1500), /Workflow interpretation timed out/, tag('timeout'));
  const [h] = await records(hang);
  assert.ok(h && await gone(h.pid), tag('timeout-child-killed'));
  await scenario();
  await assert.rejects(interpretChat({ ...cfg, cliPath: path.join(owned, 'missing-native-cli.exe') }, toolJob()), /Teaching interpreter unavailable/, tag('unavailable-distinct'));
  assert.deepEqual(readdirSync(path.join(cfg.directory, 'jobs')), [], tag('cleanup-jobs-unavailable'));
});

test('concurrent independently configured workers each deliver only their own credential', async () => {
  const dir = await scenario();
  const a = await base({ nativeOAuthToken: tokenA }), b = await base({ nativeOAuthToken: tokenB });
  const plan = [['A', a], ['B', b], ['A', a], ['B', b]];
  const before = envSnapshot();
  await Promise.all([...plan.map(([n, c], i) => callers['teaching-mcp'](c, toolJob('call-' + n + '-' + i))), ...plan.map(([n, c], i) => callers.finalization(c, { marker: 'flow-' + n + '-' + i }))]);
  const all = await records(dir);
  assert.equal(all.length, 8, tag('setup:concurrency-children'));
  for (const r of all) {
    const m = r.stdin.match(/(call|flow)-([AB])-\d/);
    assert.ok(m, tag('setup:concurrency-marker'));
    assert.equal(r.auth.sha, sha(m[2] === 'A' ? tokenA : tokenB), tag('concurrency'));
    if (m[1] === 'call') assert.equal(r.servers[0].envAuth, 'blank', tag('concurrency-mcp'));
  }
  assert.equal(envSnapshot(), before, tag('process-env-unchanged-concurrency'));
  for (const c of [a, b]) assert.deepEqual(readdirSync(path.join(c.directory, 'jobs')), [], tag('cleanup-jobs-concurrency'));
});

// ── Local provisioning command on an owned DPAPI Vault ──────────────────────────────────────────────────────────────────
const runConfigure = (args, input, { end = true } = {}) => new Promise(resolve => {
  const child = cp.spawn(process.execPath, [configureScript, ...args], { cwd: owned, windowsHide: true, env: { ...process.env, OMF_NATIVE_OAUTH_TOKEN: tokenB, NATIVE_OAUTH_TOKEN: tokenB }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = ''; const started = Date.now();
  child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d); child.stdin.on('error', () => {});
  if (input !== undefined) child.stdin.write(input);
  if (end) child.stdin.end();
  child.on('close', code => { if (!end) child.stdin.destroy(); resolve({ code, out, err, ms: Date.now() - started }); });
});
const provisioningReady = () => { assert.equal(process.platform, 'win32', tag('setup:windows-dpapi-required')); assert.ok(existsSync(configureScript), tag('setup:configure-command-missing')); };
const original = () => ({ enabled: true, baseUrl: 'http://127.0.0.1:9/', token: serverToken, cliPath: marker, inferenceDirectory: inference, claudeConfigDirectory: profile, publicResearch: false, ntaApplicationId: 'SYNTHETIC0001A', documentEnabled: true, accounts: { synthetic: { id: 'x', note: unicode } } });
async function ownedVault(fields = original()) { const dir = await freshDir('vault'); await new Vault(dir).update(() => fields); return dir; }

test('owned DPAPI Vault: the stdin-only command sets, reads back, replaces and clears only the native credential', async () => {
  provisioningReady();
  const dir = await ownedVault(), file = path.join(dir, 'credentials.dpapi');
  const set = await runConfigure(['--vault', dir, '--set'], tokenA + '\r\n');
  assert.equal(set.code, 0, tag('configure-set'));
  assert.equal(set.out, '{"nativeOAuthToken":"configured"}\n', tag('configure-set-output'));
  assert.equal((set.out + set.err).includes(tokenA), false, tag('configure-output-no-leak'));
  const raw = await fs.readFile(file);
  for (const form of [Buffer.from(tokenA), Buffer.from(tokenA, 'utf16le'), Buffer.from(Buffer.from(tokenA).toString('base64'))]) assert.equal(raw.includes(form), false, tag('vault-encrypted'));
  const read = await new Vault(dir).read();
  assert.equal(read.nativeOAuthToken, tokenA, tag('vault-read'));
  const { nativeOAuthToken, ...rest } = read; void nativeOAuthToken;
  assert.deepEqual(rest, original(), tag('vault-preserve (OMF bearer, account grants, cliPath and settings unchanged)'));
  const viaVault = await scenario();
  await callers['teaching-mcp']({ ...read, directory: dir });
  const [r1] = await records(viaVault);
  assert.equal(r1.auth.sha, sha(tokenA), tag('vault-to-child'));
  assert.equal(r1.configDir, profile, tag('vault-profile-directory-unchanged'));
  assert.equal(r1.servers[0].envAuth, 'blank', tag('vault-to-child-mcp-blank'));
  const replace = await runConfigure(['--set', '--vault', dir], tokenB);
  assert.equal(replace.code, 0, tag('configure-replace'));
  assert.equal((await new Vault(dir).read()).nativeOAuthToken, tokenB, tag('configure-replace'));
  const clear = await runConfigure(['--vault', dir, '--clear']);
  assert.equal(clear.code, 0, tag('configure-clear'));
  assert.equal(clear.out, '{"nativeOAuthToken":"cleared"}\n', tag('configure-clear-output'));
  const cleared = await new Vault(dir).read();
  assert.equal(Object.hasOwn(cleared, 'nativeOAuthToken'), false, tag('vault-clear'));
  assert.deepEqual(cleared, original(), tag('vault-clear-preserve'));
  const again = await runConfigure(['--vault', dir, '--clear']);
  assert.equal(again.code, 0, tag('configure-clear-idempotent'));
  assert.deepEqual(await new Vault(dir).read(), original(), tag('vault-clear-preserve'));
  const afterClear = await scenario();
  await callers['teaching-mcp']({ ...cleared, directory: dir });
  const [r2] = await records(afterClear);
  assert.equal(r2.auth.present, false, tag('vault-clear-default'));
  assert.equal(r2.servers[0].envAuth, 'absent', tag('vault-clear-default'));
});

test('provisioning refuses argument, environment, invalid, oversized, missing, linked and ambiguous input without rewriting the Vault', async () => {
  provisioningReady();
  const dir = await ownedVault(), file = path.join(dir, 'credentials.dpapi'), bytes = await fs.readFile(file);
  const refused = async (label, args, input, secret = '') => {
    const r = await runConfigure(args, input);
    assert.notEqual(r.code, 0, tag('configure-refuses-' + label));
    for (const v of [tokenA, tokenB, secret].filter(Boolean)) assert.equal((r.out + r.err).includes(v), false, tag('configure-output-no-leak-' + label));
    assert.equal(r.out, '', tag('configure-no-status-' + label));
    assert.deepEqual(await fs.readFile(file), bytes, tag('configure-vault-untouched-' + label));
  };
  await refused('argument', ['--vault', dir, '--set', tokenA], tokenA);
  await refused('argument-only', ['--vault', dir, tokenA]);
  await refused('environment', ['--vault', dir, '--set'], '');
  await refused('space', ['--vault', dir, '--set'], 'synthetic native with space ' + 'd'.repeat(24), 'synthetic native with space');
  await refused('two-lines', ['--vault', dir, '--set'], tokenA + '\n\n');
  await refused('control', ['--vault', dir, '--set'], 'synthetic-native\u0007' + 'e'.repeat(24));
  await refused('short', ['--vault', dir, '--set'], 'short-token');
  await refused('non-ascii', ['--vault', dir, '--set'], 'あ'.repeat(30));
  await refused('oversized', ['--vault', dir, '--set'], 'f'.repeat(9000));
  await refused('ambiguous', ['--vault', dir, '--set', '--clear'], tokenA);
  await refused('no-action', ['--vault', dir], tokenA);
  await refused('no-arguments', [], tokenA);
  await refused('duplicate-vault', ['--vault', dir, '--vault', dir, '--clear']);
  await refused('relative', ['--vault', 'relative-vault', '--clear']);
  const missing = path.join(owned, 'missing-vault-' + (++sequence));
  await refused('missing-directory', ['--vault', missing, '--clear']);
  assert.equal(existsSync(missing), false, tag('configure-missing-not-created'));
  const empty = await freshDir('empty-vault');
  await refused('missing-vault-file', ['--vault', empty, '--set'], tokenA);
  assert.deepEqual(readdirSync(empty), [], tag('configure-missing-not-created'));
  const link = path.join(owned, 'vault-junction-' + (++sequence));
  await fs.symlink(dir, link, 'junction');
  try { await refused('junction', ['--vault', link, '--set'], tokenA); }
  finally { await fs.unlink(link).catch(() => fs.rmdir(link)); }
  assert.equal(existsSync(link), false, tag('setup:junction-removed'));
  assert.deepEqual(await fs.readFile(file), bytes, tag('configure-vault-untouched-junction'));
});

test('provisioning standard input is bounded in time', async () => {
  provisioningReady();
  const dir = await ownedVault(), file = path.join(dir, 'credentials.dpapi'), bytes = await fs.readFile(file);
  const r = await runConfigure(['--vault', dir, '--set'], tokenA.slice(0, 12), { end: false });
  assert.notEqual(r.code, 0, tag('configure-timeout'));
  assert.ok(/timed out/i.test(r.err) && r.ms < 40000, tag('configure-timeout'));
  assert.deepEqual(await fs.readFile(file), bytes, tag('configure-vault-untouched-timeout'));
});

test('provisioning: concurrent commands on independent Vaults and on one Vault leave a consistent encrypted state', async () => {
  provisioningReady();
  const [one, two] = [await ownedVault(), await ownedVault()];
  const [a, b] = await Promise.all([runConfigure(['--vault', one, '--set'], tokenA), runConfigure(['--vault', two, '--set'], tokenB)]);
  assert.equal(a.code + b.code, 0, tag('configure-concurrent-independent'));
  assert.equal((await new Vault(one).read()).nativeOAuthToken, tokenA, tag('configure-concurrent-independent'));
  assert.equal((await new Vault(two).read()).nativeOAuthToken, tokenB, tag('configure-concurrent-independent'));
  const same = await ownedVault();
  const results = await Promise.all([runConfigure(['--vault', same, '--set'], tokenA), runConfigure(['--vault', same, '--set'], tokenB)]);
  const succeeded = [tokenA, tokenB].filter((_, i) => results[i].code === 0);
  assert.ok(succeeded.length >= 1, tag('configure-concurrent-same'));
  const final = await new Vault(same).read();
  assert.ok(succeeded.includes(final.nativeOAuthToken), tag('configure-concurrent-same'));
  const { nativeOAuthToken, ...rest } = final; void nativeOAuthToken;
  assert.deepEqual(rest, original(), tag('configure-concurrent-same-preserve'));
  for (const r of [a, b, ...results]) assert.equal((r.out + r.err).includes(tokenA) || (r.out + r.err).includes(tokenB), false, tag('configure-output-no-leak-concurrent'));
});

test('teaching worker entrypoint: the Vault credential reaches the native child end to end; OMF bearer distinct; logs carry none', async () => {
  assert.equal(process.platform, 'win32', tag('setup:windows-dpapi-required'));
  const id = '0123456789abcdef01234567';
  const job = { id, mode: 'workspace', lease: 'synthetic-lease', text: unicode, context: { mode: 'workspace', pageName: 'Synthetic', facts: {}, capabilities: [], messages: [] }, tools: toolJob().tools, nextSlot: 1 };
  const seen = { auth: new Set(), bodies: [], result: null }; let claimed = false;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    seen.auth.add(req.headers.authorization); seen.bodies.push(body);
    const route = req.url.replace('/api/finance-chat/worker/', '');
    let answer = {};
    if (route === 'workspace-claim') { answer = { job: claimed ? null : job }; claimed = true; }
    else if (route === 'claim') answer = { job: null };
    else if (route === 'workspace/' + id + '/result') { seen.result = JSON.parse(body); answer = { success: true }; }
    res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' }); res.end(JSON.stringify(answer));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const origin = 'http://127.0.0.1:' + server.address().port + '/';
    // The worker Vault holds the credential exactly as the provisioning command stores it (its own test above); the real
    // entrypoint reads that Vault itself.
    const dir = await ownedVault({ enabled: true, baseUrl: origin, token: serverToken, cliPath: marker, inferenceDirectory: inference, claudeConfigDirectory: profile, publicResearch: false, nativeOAuthToken: tokenA });
    const recordsDir = path.join(owned, 'records', String(++sequence));
    const child = cp.spawn(process.execPath, ['--import', pathToFileURL(intercept).href, path.join(root, 'teaching-worker/run.mjs'), '--once'], { cwd: owned, windowsHide: true, env: { ...process.env, OMF_TEACHING_DATA_DIR: dir, OMF_NATIVE_AUTH_STANDIN: JSON.stringify({ marker, standin, scenario: { mode: 'ok', records: recordsDir, summary: unicode } }) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
    const timer = setTimeout(() => child.kill(), 60000);
    const code = await new Promise(r => child.on('close', r)); clearTimeout(timer);
    assert.equal(code, 0, tag('setup:entrypoint-exit'));
    assert.equal(seen.result?.proposal?.summary, unicode, tag('entrypoint-result'));
    const [r] = await records(recordsDir);
    assert.ok(r, tag('setup:entrypoint-no-child'));
    assert.equal(r.auth.present && r.auth.sha, sha(tokenA), tag('entrypoint-configured worker child did not receive the Vault credential'));
    assert.equal(r.servers[0].envAuth, 'blank', tag('entrypoint-mcp-blank'));
    assert.equal(r.ambientProbe, '', tag('entrypoint-allowlist-preserved'));
    assert.deepEqual([...seen.auth], ['Bearer ' + serverToken], tag('server-token-distinct'));
    assert.equal(seen.bodies.some(b => b.includes(tokenA)), false, tag('api-no-leak'));
    assert.equal(log.includes(tokenA), false, tag('worker-log-no-leak'));
    assert.deepEqual(readdirSync(path.join(dir, 'jobs')), [], tag('cleanup-jobs-entrypoint'));
  } finally { await new Promise(r => server.close(r)); }
});

test('no owned file holds a plaintext credential; process environment restored by the harness only', async () => {
  const forms = [tokenA, tokenB].flatMap(t => [Buffer.from(t), Buffer.from(t, 'utf16le')]);
  const leaks = [];
  const walk = dir => { for (const e of readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (lstatSync(f).isSymbolicLink()) { leaks.push('link:' + path.relative(owned, f)); continue; } if (e.isDirectory()) walk(f); else if (forms.some(x => readFileSync(f).includes(x))) leaks.push(path.relative(owned, f)); } };
  walk(owned);
  assert.deepEqual(leaks, [], tag('no-file-leak'));
  assert.equal(process.env[KEY], ambient, tag('process-env-unchanged'));
});

after(async () => {
  for (const [k, v] of Object.entries(savedAmbient)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  for (const pid of seam.spawned) { try { process.kill(pid, 0); process.kill(pid); } catch {} }
  if (!path.resolve(owned).startsWith(prefix) || path.dirname(owned) !== path.resolve(os.tmpdir())) throw Error('Unsafe owned cleanup path');
  // Links are removed as links first (never followed); only then is the owned directory deleted.
  const links = [];
  const collect = dir => { for (const e of readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (!inside(f)) throw Error('Unsafe owned cleanup path'); if (lstatSync(f).isSymbolicLink()) links.push(f); else if (e.isDirectory()) collect(f); } };
  collect(owned);
  for (const f of links) await fs.unlink(f).catch(() => fs.rmdir(f));
  links.length = 0; collect(owned);
  if (links.length) throw Error('An owned link could not be removed; refusing the recursive cleanup');
  await fs.rm(owned, { recursive: true, force: true });
});
