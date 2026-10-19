const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..'), requireRoot = Module.createRequire(path.join(root, 'package.json'));
async function main() {
  assert.equal(process.env.OMF_ARCHIVE_FIXTURE, 'owned');
  const { MongoMemoryServer } = requireRoot('mongodb-memory-server'), mongoose = requireRoot('mongoose');
  const mongo = await MongoMemoryServer.create();
  try {
    process.env.JWT_SECRET = require('node:crypto').randomBytes(32).toString('hex');
    process.env.MONGO_URI = mongo.getUri('omf_archive_owned');
    await mongoose.connect(process.env.MONGO_URI); assert.equal(mongoose.connection.name, 'omf_archive_owned');
    const { outputFiles } = await requireRoot('esbuild').build({ stdin: { contents: "export { startNewCompanyConversation, listCompanyConversationArchives, getCompanyConversationArchive } from './server/services/companyConversationHistoryService.ts'; export { FinanceCompanyAssistant as Conversation } from './server/models/FinanceCompanyAssistant.ts'; export { FinanceCompanyConversationArchive as Archive } from './server/models/FinanceCompanyConversationArchive.ts';", resolveDir: root, sourcefile: 'owned-archive-entry.ts' }, bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, logLevel: 'silent' });
    const native = new Module(path.join(root, 'scripts/owned-archive-entry.cjs'), module); native.filename = path.join(root, 'scripts/owned-archive-entry.cjs'); native.paths = Module._nodeModulePaths(path.join(root, 'scripts')); native._compile(outputFiles[0].text, native.filename);
    const { Conversation, Archive, startNewCompanyConversation: reset, listCompanyConversationArchives: list, getCompanyConversationArchive: detail } = native.exports;
    await Conversation.init(); await Archive.init();
    async function setup() {
      const ownerId = new mongoose.Types.ObjectId(), organizationId = new mongoose.Types.ObjectId();
      const turns = [{ id: 'owned-original-turn', text: 'LATEST_PRESERVED_MESSAGE', at: new Date(), actions: [{ operationId: 'b'.repeat(32), name: 'update_company_transaction', state: 'unresolved', safeError: 'OWNED_UNKNOWN_RECEIPT' }] }];
      const c = await Conversation.create({ ownerId, organizationId, revision: 1, segment: 0, state: 'ready', turns });
      const copy = await Archive.create({ ownerId, organizationId, conversationId: c._id, segment: 0, resetId: 'old-reset-request-0000', fromRevision: 0, turns: [{ id: 'older-turn', text: 'OLDER_UNADOPTED_COPY' }], turnCount: 1 });
      return { ownerId: String(ownerId), organizationId, c, copy };
    }
    const first = await setup(), requestId = 'first-reset-request-0001';
    await reset(first.ownerId, first.organizationId, { chatRevision: 1, requestId });
    const saved = await Archive.findOne({ conversationId: first.c._id, segment: 0 }).lean();
    assert.equal(String(saved._id), String(first.copy._id), 'archive:stale-copy-keeps-id-without-delete-window');
    assert.equal(saved.turns[0].text, 'LATEST_PRESERVED_MESSAGE');
    assert.equal(saved.turns[0].actions[0].state, 'unresolved', 'archive:unknown-outcome-preserved');
    assert.equal(saved.fromRevision, 1);
    const live = await Conversation.findById(first.c._id).lean(); assert.equal(live.segment, 1); assert.deepEqual(live.turns, []);
    await reset(first.ownerId, first.organizationId, { chatRevision: 1, requestId });
    assert.equal(await Archive.countDocuments({ conversationId: first.c._id }), 1, 'archive:lost-reset-retry-once');
    const listed = await list(first.ownerId, first.organizationId); assert.equal(listed.archives.length, 1);
    assert.equal((await detail(first.ownerId, first.organizationId, String(saved._id))).archive.turns[0].text, 'LATEST_PRESERVED_MESSAGE');
    const parallel = await setup();
    assert.equal((await list(parallel.ownerId, parallel.organizationId)).archives.length, 0, 'archive:unadopted-copy-hidden');
    const attempts = await Promise.allSettled(['parallel-reset-request-0001','parallel-reset-request-0002'].map(requestId => reset(parallel.ownerId, parallel.organizationId, { chatRevision: 1, requestId })));
    assert.ok(attempts.some(r => r.status === 'fulfilled'), 'archive:one-parallel-reset-completes');
    for (const r of attempts) if (r.status === 'rejected') assert.equal(r.reason.statusCode, 409, 'archive:raced-reset-has-reload-exit');
    const parallelLive = await Conversation.findById(parallel.c._id).lean(), copies = await Archive.find({ conversationId: parallel.c._id }).lean();
    assert.equal(parallelLive.segment, 1); assert.equal(copies.length, 1); assert.equal(String(copies[0]._id), String(parallel.copy._id));
    assert.equal(copies[0].turns[0].text, 'LATEST_PRESERVED_MESSAGE'); assert.equal(copies[0].turns[0].actions[0].state, 'unresolved');
    assert.equal((await list(parallel.ownerId, parallel.organizationId)).archives.length, 1);
    console.log('PASS owned stale-copy id, latest turns/unknown receipt, lost retry, hidden candidate and parallel reset recovery');
  } finally { await mongoose.disconnect(); await mongo.stop(); }
}
// The imported native auth module owns a cleanup timer. Exit only after the awaited database cleanup above.
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
