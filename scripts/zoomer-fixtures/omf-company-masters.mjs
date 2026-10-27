// Fixture for plan omf-tenant-masters-20261026 (step 1): supplier, customer and tax-category lists per company, and the
// オーマイジャパン-only Intras account literal and ISSEY archive tooling out of what a buyer's OMF runs.
// Run ONLY through the hub verifier (never directly; a direct run dropped the hub database on 2026-09-17):
//   node scripts/zoomer-verify.mjs --run-fixture omf-company-masters.mjs --cwd <this worktree>
// Legs: 1 the built app (scripts/finance-company-masters-integration.cjs on its own throwaway MongoDB: M1-M7 and W2; NOT RUN and
// red when .output/server/index.mjs is missing) · 2 the worker units (W1 Intras account, the status report, the ISSEY orders gate,
// W3 tool catalogue / tool call / research prompt / MCP tools/list) plus scripts/finance-issey-archive.test.mjs and
// scripts/finance-workflow-worker.test.mjs, run as `node --test` in an owned copy of the worker sources that borrows the main
// checkout's collector package cache as a verified regular copy (a nested worktree has no collector/node_modules; links are refused)
// · 3 an unchanged packaged copy of the build must pass · 4 the plan's five compiled defects, each required to flip its named leg-1
// assertion · 5 four worker source defects (restored account literal, ungated tools, unconditional prompt, silent status) in the
// owned copy, each required to flip its named leg-2 assertion. Synthetic companies, users and rows only; no production database,
// model, Intras, ISSEY, Slack or mail. Fail-first on 0727c0c: leg 1 at masters:list-isolation (every company sees every row),
// leg 2 at worker:intras-configured-account / worker:status-connections / worker:orders-gated / worker:issey-tools-gated.
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const timeoutMs = 3000000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUILT = existsSync(path.join(root, '.output', 'server', 'index.mjs'));
const marker = n => n + ' Company master groups passed';
const groups = 8;
const APP_COVERS = ['server/models/Customer.ts', 'server/models/Supplier.ts', 'server/models/TaxCategory.ts', 'server/models/FinanceWorkflow.ts', 'server/api/suppliers/index.ts', 'server/api/suppliers/[id].ts', 'server/api/customers/index.ts', 'server/api/customers/[id].ts', 'server/api/tax-categories/index.ts', 'server/api/vendors/index.ts', 'server/api/transactions/import.ts', 'server/api/transactions/import-preview.ts', 'server/api/seed/index.ts', 'server/services/transactionService.ts', 'server/services/companyNaviBusinessService.ts', 'server/utils/calendarAccess.ts', 'server/services/financeDraftService.ts', 'server/services/financeSupplierService.ts', 'server/services/financeLearningService.ts', 'server/services/financeResearchService.ts', 'server/services/financeBankClassificationService.ts', 'server/services/financeActionService.ts', 'server/services/financeWorkflowService.ts', 'server/api/finance/[...path].ts', 'server/api/finance-research/[...path].ts', 'scripts/finance-company-masters-integration.cjs'];
const WORKER_COVERS = ['finalization-worker/worker.mjs', 'finalization-worker/intras.mjs', 'research-worker/tools.mjs', 'research-worker/mcp.mjs', 'research-worker/worker.mjs', 'scripts/finance-workflow-worker-integration.cjs', 'scripts/zoomer-fixtures/omf-company-masters.mjs'];
const SOURCE_DIRS = ['shared', 'research-worker', 'teaching-worker', 'collector', 'finalization-worker'];
const SOURCE_TESTS = ['scripts/finance-issey-archive.test.mjs', 'scripts/finance-workflow-worker.test.mjs'];
const UNIT_TEST = 'scripts/company-masters-worker.test.mjs';

const exec = (args, cwd, env = {}, timeout = 900000) => new Promise(resolve => execFile(process.execPath, args, { cwd, windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, MONGO_URI: '', MONGODB_URI: '', NUXT_MONGO_URI: '', ...env } }, (e, stdout, stderr) => resolve({ code: e ? e.code ?? 1 : 0, killed: !!e?.killed, text: stdout + stderr })));
const integration = app => exec([path.join(root, 'scripts/finance-company-masters-integration.cjs')], root, { OMF_COMPANY_MASTERS_APP_ROOT: app }, 600000);
const unitPassed = r => r.code === 0 && /\bfail 0\b/.test(r.text) && !/\bpass 0\b/.test(r.text);
const tail = r => r.text.split(/\r?\n/).filter(l => /Error|assert|expected|actual|masters:|worker:|PASS |at /.test(l)).slice(0, 14).join(' | ').slice(0, 2400) || r.text.slice(-1200);
// A regular-file tree summary (count, bytes, path+content hash); any link is refused (the collector cache is copied, never linked).
async function regularTree(top) { let count = 0, bytes = 0; const h = createHash('sha256'); const walk = async d => { for (const e of (await readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) { const f = path.join(d, e.name), st = await lstat(f); if (st.isSymbolicLink()) throw Error('Collector cache entry is a link: ' + f); if (st.isDirectory()) await walk(f); else if (st.isFile()) { const b = await readFile(f); h.update(path.relative(top, f)); h.update(b); count++; bytes += b.length; } } }; await walk(top); return { count, bytes, hash: h.digest('hex') }; }
async function collectorCache() { const local = path.join(root, 'collector', 'node_modules'); if (existsSync(local)) return local; const common = await new Promise(resolve => execFile('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { windowsHide: true }, (e, out) => resolve(e ? '' : out.trim()))); const main = common ? path.join(path.dirname(common), 'collector', 'node_modules') : ''; if (!main || !existsSync(main)) throw Error('No collector package cache: neither collector/node_modules nor the main checkout\'s'); return main; }

// The worker unit test written into the owned copy (never into the repository): real worker modules, synthetic configuration,
// a sentinel instead of any browser, no Intras, ISSEY, mail or model call.
const unitTest = String.raw`
import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {IntrasCollector} from '../finalization-worker/intras.mjs';import {FinalizationWorker} from '../finalization-worker/worker.mjs';
import {toolDefinitions,ResearchTools} from '../research-worker/tools.mjs';import * as research from '../research-worker/worker.mjs';import {isseyArchiveContract} from '../research-worker/issey-archive.mjs';import {Vault} from '../collector/vault.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),target={providerAccount:'synthetic-buyer',orderId:'AB-12',tracking:'123456789'};
test('worker:intras-configured-account',async()=>{
 const sentinel=Object.assign(Error('SENTINEL open'),{code:'sentinel'}),collector=config=>new IntrasCollector(config,{open:async()=>{throw sentinel}});
 await assert.rejects(()=>collector({workflow:{intras:{account:'synthetic-buyer',profile:'synthetic-profile'}}}).collect(target),e=>e.code==='sentinel','worker:intras-configured-account');
 await assert.rejects(()=>collector({workflow:{intras:{account:'synthetic-buyer',profile:'synthetic-profile'}}}).collect({...target,providerAccount:'another-account'}),e=>e.code==='connection_required'&&/not configured/.test(e.message),'worker:intras-identity');
 await assert.rejects(()=>collector({workflow:{intras:{account:'',profile:'synthetic-profile'}}}).collect({...target,providerAccount:''}),e=>e.code==='connection_required','worker:intras-no-account');
 await assert.rejects(()=>collector({workflow:{}}).collect(target),e=>e.code==='connection_required','worker:intras-no-account');
});
test('worker:status-connections',async()=>{
 const report=async config=>{let captured;const w=new FinalizationWorker({baseUrl:'http://127.0.0.1:8080',...config},'unused',{archiveFactory:()=>({searched:new Map()}),log:()=>{}});w.api=async(route,body)=>{if(route==='status'){captured=body;return {config:{enabled:false}}}throw Error('unexpected '+route)};assert.equal(await w.cycle(),false);return captured};
 const configured=await report({workflow:{intras:{account:'synthetic-buyer',profile:'p'}}});assert.deepEqual(configured.connections,{intras:{account:'synthetic-buyer'}},'worker:status-connections');assert.ok(configured.capabilities.includes('documents'));
 const none=await report({workflow:{}});assert.equal(none.connections,undefined,'worker:status-connections-unset');assert.ok(!none.capabilities.includes('documents'));
});
test('worker:orders-gated',async()=>{
 const kinds=async config=>{const seen=[];const w=new FinalizationWorker({baseUrl:'http://127.0.0.1:8080',...config},'unused',{archiveFactory:()=>({searched:new Map(),catalog:async()=>({orders:[],runs:[]})}),log:()=>{}});
  const run={id:'synthetic',lease:'lease',day:'2026-10-27',deadline:new Date(Date.now()+60000).toISOString(),policy:{accountIds:['1'.repeat(24)],from:'2026-01-01',through:'2026-12-31'}};
  w.snapshot=async(_run,kind)=>{seen.push(kind);return {id:kind,complete:true,payload:{orders:[]}}};
  w.api=async route=>{if(route==='status')return {config:{enabled:true}};if(route==='claim')return {run};if(route.endsWith('/context'))return {rows:[],purchases:[],shipments:[]};if(route.endsWith('/receipts'))return {documents:[]};if(route.endsWith('/finish'))return {};throw Error('unexpected '+route)};
  assert.equal(await w.cycle(),true);return seen};
 assert.deepEqual(await kinds({}),['inventory','shipping'],'worker:orders-gated');
 assert.deepEqual(await kinds({isseyArchive:{financialAccountIds:['1'.repeat(24)],accountIds:['e']}}),['inventory','shipping','orders'],'worker:orders-configured');
});
test('worker:issey-tools-gated',async()=>{
 const names=d=>d.map(t=>t.name),issey=n=>n==='search_issey_orders'||n==='read_issey_order';
 assert.ok(!names(toolDefinitions({})).some(issey),'worker:issey-tools-gated');assert.ok(names(toolDefinitions({})).includes('verify_invoice'));
 assert.deepEqual(names(toolDefinitions({isseyArchive:{}})).filter(issey),['search_issey_orders','read_issey_order'],'worker:issey-tools-configured');
 const job={id:'j',mode:'research',lease:'l',sources:[],context:{source:{purchaseDate:'2026-10-01',account:{id:'1'.repeat(24)}},documents:[]}},dir=await mkdtemp(path.join(os.tmpdir(),'omf-masters-tools-'));
 try{await assert.rejects(()=>new ResearchTools({},job,dir).call('search_issey_orders',{}),/Unknown research tool/,'worker:issey-tools-gated call');
  await assert.rejects(()=>new ResearchTools({isseyArchive:{}},job,dir).call('search_issey_orders',{}),e=>!/Unknown research tool/.test(e.message),'worker:issey-tools-configured call');}
 finally{await rm(dir,{recursive:true,force:true})}
 assert.equal(typeof research.researchSystemFor,'function','worker:prompt-gated');
 assert.ok(!research.researchSystem.includes(isseyArchiveContract),'worker:prompt-gated');assert.equal(research.researchSystemFor({}),research.researchSystem,'worker:prompt-gated');
 assert.equal(research.researchSystemFor({isseyArchive:{}}),research.researchSystem+' '+isseyArchiveContract,'worker:prompt-configured');
 assert.ok(research.correctionSystemFor({isseyArchive:{}}).startsWith(research.researchSystem+' '+isseyArchiveContract+' Correct '),'worker:prompt-configured correction');assert.ok(!research.correctionSystemFor({}).includes(isseyArchiveContract),'worker:prompt-gated correction');
});
test('worker:mcp-tools-gated',async()=>{
 const list=async vault=>{const dir=await mkdtemp(path.join(os.tmpdir(),'omf-masters-mcp-'));let child;try{await new Vault(dir).update(()=>vault);const jobDir=path.join(dir,'jobs',randomUUID());await mkdir(jobDir,{recursive:true});await writeFile(path.join(jobDir,'job.json'),JSON.stringify({id:'j',mode:'research',lease:'l',sources:[],context:{source:{purchaseDate:'2026-10-01'},documents:[]}}));
  child=spawn(process.execPath,[path.join(root,'research-worker/mcp.mjs')],{cwd:root,windowsHide:true,env:{...process.env,OMF_RESEARCH_DATA_DIR:dir,OMF_RESEARCH_JOB_FILE:path.join(jobDir,'job.json')},stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.stdin.on('error',()=>{});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})+'\n');
  const started=Date.now(),line=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('tools/list timed out after '+(Date.now()-started)+'ms; stderr: '+err.slice(0,600))),120000);const tick=()=>{const i=out.indexOf('\n');if(i>=0){clearTimeout(t);resolve(out.slice(0,i))}else if(child.exitCode!==null){clearTimeout(t);reject(Error('mcp exited '+child.exitCode+' after '+(Date.now()-started)+'ms; stderr: '+err.slice(0,600)))}else setTimeout(tick,50)};tick()});
  const reply=JSON.parse(line);if(!reply.result)throw Error('tools/list error reply: '+line.slice(0,400));
  return reply.result.tools.map(t=>t.name)}finally{if(child)child.kill();await rm(dir,{recursive:true,force:true})}};
 const plain=await list({enabled:true});assert.ok(plain.includes('verify_invoice')&&!plain.includes('search_issey_orders')&&!plain.includes('read_issey_order'),'worker:mcp-tools-gated '+plain.join(','));
 const configured=await list({enabled:true,isseyArchive:{baseUrl:'http://127.0.0.1:5088',token:'private-test-token-'.repeat(4),accountIds:['11111111-1111-1111-1111-111111111111'],financialAccountIds:['1'.repeat(24)]}});
 assert.ok(configured.includes('search_issey_orders')&&configured.includes('read_issey_order'),'worker:mcp-tools-configured '+configured.join(','));
});
`;

// The plan's five compiled defects: a whitespace-exact anchor in the built nitro chunks, the defect text and the leg-1 assertion.
const COMPILED_MUTANTS = [
  { name: 'unscoped-supplier-list', anchor: 'const suppliers = await Supplier.find({ ...searchQuery, organizationId })', replacement: 'const suppliers = await Supplier.find({ ...searchQuery })', assertion: 'masters:list-isolation suppliers' },
  { name: 'trust-body-company-on-create', anchor: 'const supplier = new Supplier({ ...body, organizationId });', replacement: 'const supplier = new Supplier({ ...body, organizationId: body.organizationId || organizationId });', assertion: 'masters:body-company-ignored suppliers' },
  { name: 'unscoped-supplier-id', anchor: 'const supplier = await Supplier.findOne({ _id: id, organizationId }).lean();', replacement: 'const supplier = await Supplier.findOne({ _id: id }).lean();', assertion: 'masters:id-isolation GET suppliers' },
  { name: 'unscoped-reference-exists', anchor: 'const referenceScope = (key, _id, organizationId) => scopedReferenceFields.includes(key) ? { _id, organizationId } : { _id };', replacement: 'const referenceScope = (key, _id, organizationId) => ({ _id });', assertion: 'masters:foreign-reference supplierId' },
  { name: 'restored-intras-literal', anchor: 'const providerAccount = config.workerIntrasAccount;', replacement: 'const providerAccount = "ohmyjapan1";', assertion: 'worker:provider-account' }
];
// Worker source defects in the owned copy: each must flip its named leg-2 assertion.
const SOURCE_MUTANTS = [
  { name: 'restored-collector-literal', file: 'finalization-worker/intras.mjs', anchor: "!connection||!connection.account||", replacement: "!connection||connection.account!=='ohmyjapan1'||", assertion: 'worker:intras-configured-account' },
  { name: 'ungated-issey-tools', file: 'research-worker/tools.mjs', anchor: 'config?.isseyArchive?toolCatalogue:toolCatalogue.filter(t=>!isseyTools.has(t.name))', replacement: 'toolCatalogue', assertion: 'worker:issey-tools-gated' },
  { name: 'unconditional-issey-prompt', file: 'research-worker/worker.mjs', anchor: "config?.isseyArchive?' '+isseyArchiveContract:''", replacement: "' '+isseyArchiveContract", assertion: 'worker:prompt-gated' },
  { name: 'silent-status-connections', file: 'finalization-worker/worker.mjs', anchor: '...(this.config.workflow?.intras?.account?{connections:{intras:{account:this.config.workflow.intras.account}}}:{})', replacement: '', assertion: 'worker:status-connections' }
];

export default { name: 'omf-company-masters', covers: BUILT ? [...APP_COVERS, ...WORKER_COVERS] : WORKER_COVERS, async run() {
  const lines = [], controls = [], mutants = []; let pass = true, positive = null, unit = null, provision = null;
  const base = path.resolve(root, '.zoomer', 'company-masters'), directory = path.resolve(base, randomUUID()); if (!directory.startsWith(base + path.sep)) throw Error('Unsafe owned test directory'); await mkdir(directory, { recursive: true });
  try {
    // 1 built app
    if (!BUILT) { pass = false; lines.push('1 built app: NOT RUN — .output/server/index.mjs is missing (run nuxt build first); no coverage claimed'); }
    else { positive = await integration(root); const green = positive.code === 0 && positive.text.includes(marker(groups)); if (!green) pass = false; lines.push(`1 built app: ${green ? 'ok' : 'RED'} (exit ${positive.killed ? 'timeout' : positive.code}; ${(positive.text.match(/^PASS /gm) || []).length}/${groups} groups) ${green ? '' : tail(positive)}`); if (!green) lines.push('1 built app full output: ' + positive.text.replace(/\s+/g, ' ').slice(-7000)); }
    // 2 worker units in an owned source copy with the main checkout's collector package cache (verified regular copy)
    const copy = path.join(directory, 'src');
    for (const d of SOURCE_DIRS) await cp(path.join(root, d), path.join(copy, d), { recursive: true, filter: p => !p.split(path.sep).includes('node_modules') });
    await mkdir(path.join(copy, 'scripts'), { recursive: true });
    for (const t of SOURCE_TESTS) await cp(path.join(root, t), path.join(copy, t));
    await writeFile(path.join(copy, UNIT_TEST), unitTest, { flag: 'wx' });
    const cacheFrom = await collectorCache(), cacheTo = path.join(copy, 'collector', 'node_modules'), want = await regularTree(cacheFrom);
    await cp(cacheFrom, cacheTo, { recursive: true, errorOnExist: true, force: false, dereference: false }); const got = await regularTree(cacheTo);
    provision = { from: cacheFrom, want, got, equal: JSON.stringify(want) === JSON.stringify(got) }; if (!provision.equal) throw Error('Collector cache copy differs from its source');
    const units = () => exec(['--test', ...SOURCE_TESTS.map(t => path.join(copy, t)), path.join(copy, UNIT_TEST)], copy, {}, 600000);
    unit = await units(); if (!unitPassed(unit)) pass = false; lines.push(`2 worker units: ${unitPassed(unit) ? 'ok' : 'RED'} (exit ${unit.code}) ${unitPassed(unit) ? '' : tail(unit)}`);
    if (!unitPassed(unit)) lines.push('2 worker units full output: ' + unit.text.replace(/\s+/g, ' ').slice(0, 7000));
    // 3-4 packaged copy control and the compiled defects, only when leg 1 is green
    if (pass && positive) {
      await cp(path.join(root, '.output'), path.join(directory, '.output'), { recursive: true, dereference: true });
      const chunks = []; const walk = async d => { for (const e of await readdir(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) await walk(f); else if (f.endsWith('.mjs')) chunks.push(f); } }; await walk(path.join(directory, '.output/server/chunks'));
      const original = new Map(); const locate = async anchor => { const found = []; for (const f of chunks) { const s = original.get(f) ?? await readFile(f, 'utf8'); original.set(f, s); if (s.includes(anchor)) found.push(f); } if (found.length !== 1) throw Error('Expected one compiled chunk with ' + anchor + ' found ' + found.length); return found[0]; };
      const replace = (s, a, b) => { if (s.split(a).length !== 2) throw Error('Expected one actual anchor ' + a); return s.replace(a, b); };
      const copied = await integration(directory), copiedPass = copied.code === 0 && copied.text.includes(marker(groups)); controls.push({ name: 'unchanged-packaged-copy', pass: copiedPass, code: copied.code, tail: copiedPass ? '' : tail(copied) }); if (!copiedPass) throw Error('Packaged positive must pass before defects');
      for (const m of COMPILED_MUTANTS) { let file; try { file = await locate(m.anchor); await writeFile(file, replace(original.get(file), m.anchor, m.replacement)); const r = await integration(directory), detected = r.code !== 0 && r.text.includes('AssertionError') && r.text.includes(m.assertion); mutants.push({ name: m.name, assertion: m.assertion, detected, code: r.code, tail: detected ? '' : tail(r) }); if (!detected) pass = false; } catch (e) { pass = false; mutants.push({ name: m.name, setupError: String(e.message), detected: false }); } finally { if (file) await writeFile(file, original.get(file)); } }
      lines.push(`3 packaged control: ${copiedPass ? 'ok' : 'RED'} · 4 compiled defects detected: ${mutants.filter(m => m.detected).length}/${COMPILED_MUTANTS.length}`);
    } else lines.push('3-4 packaged control and compiled defects: NOT RUN (leg 1 or 2 red)');
    // 5 worker source defects in the owned copy, only when leg 2 is green
    if (unit && unitPassed(unit)) {
      const unitOnly = () => exec(['--test', path.join(copy, UNIT_TEST)], copy, {}, 300000);
      for (const m of SOURCE_MUTANTS) { const f = path.join(copy, m.file); let before; try { before = await readFile(f, 'utf8'); if (before.split(m.anchor).length !== 2) throw Error('Expected one actual source anchor in ' + m.file + ': ' + m.anchor); await writeFile(f, before.replace(m.anchor, m.replacement)); const r = await unitOnly(), detected = r.code !== 0 && r.text.includes(m.assertion); mutants.push({ name: m.name, assertion: m.assertion, detected, code: r.code, tail: detected ? '' : tail(r) }); if (!detected) pass = false; } catch (e) { pass = false; mutants.push({ name: m.name, setupError: String(e.message), detected: false }); } finally { if (before !== undefined) await writeFile(f, before); } }
      lines.push(`5 worker source defects detected: ${mutants.filter(m => SOURCE_MUTANTS.some(s => s.name === m.name) && m.detected).length}/${SOURCE_MUTANTS.length}`);
    } else lines.push('5 worker source defects: NOT RUN (leg 2 red)');
  } catch (e) { pass = false; lines.push('setup error: ' + String(e.message)); }
  finally { const cache = path.join(directory, 'src', 'collector', 'node_modules'); let linked = false; try { linked = (await lstat(cache)).isSymbolicLink(); } catch {} if (linked) throw Error('Owned copy cache became a link; not removing'); await rm(directory, { recursive: true, force: true }); }
  const expected = COMPILED_MUTANTS.length + SOURCE_MUTANTS.length;
  return { pass: pass && controls.length === 1 && mutants.length === expected && mutants.every(m => m.detected) && provision?.equal === true, databaseCoverage: { executed: !!positive && positive.code === 0, ownedProcess: !!positive && positive.code === 0 }, message: JSON.stringify({ lines, controls, mutants, provision: provision ? { from: provision.from, files: provision.want.count, equal: provision.equal } : null, limits: 'Seven built-app groups (company isolation of list/id/create/update/delete, body company ignored, vendors/import-preview/import/seed scoped, foreign references refused on REST and Navi create, owner intake by member companies, legacy rows listed to nobody and byte-identical, worker-reported Intras account stored and used), five worker unit tests plus the two existing worker test files, one packaged control, five compiled and four source defects. Not exercised: saveResearchSupplier stamping (needs a live research job; reviewed by reading) and the bank classification adoption read (needs a bank draft with an adoption); no real Intras, ISSEY, model or production call.' }) };
} };
