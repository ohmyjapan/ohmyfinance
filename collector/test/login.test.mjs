import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureLogin, LoginClaims, matchesRecipient } from '../login.mjs';

const account = { primaryCard: '12345', otpRecipient: 'original@example.invalid', otpMailbox: 'forwarded@example.invalid' };
test('masked recipient matching retains domain and visible local-part characters', () => {
  assert.equal(matchesRecipient('o******l@example.invalid', account.otpRecipient), true);
  assert.equal(matchesRecipient('o******x@example.invalid', account.otpRecipient), false);
  assert.equal(matchesRecipient('o******l@elsewhere.invalid', account.otpRecipient), false);
  assert.equal(matchesRecipient('*******@example.invalid', account.otpRecipient), false);
  assert.equal(matchesRecipient('a.+*z@example.invalid', 'a.+realz@example.invalid'), true);
  assert.equal(matchesRecipient('a.+*z@example.invalid', 'axxxz@example.invalid'), false);
});

function flow({ start = 'login', mailboxError = false, noMatch = false, wrongRecipient = false, loginRejected = false, mailDelay = 0 } = {}) {
  let time = 1000000, kind = start, selected = false;
  const events = [], used = [];
  const ui = {
    async open() {},
    async state() {
      if (kind === 'channels') return { kind, channels: [{ id: selected ? 'regenerated-id' : 'original-id', text: wrongRecipient ? 'x******z@example.invalid' : 'o******l@example.invalid', checked: selected }] };
      if (kind === 'code') return { kind, recipients: ['o******l@example.invalid'] };
      return { kind };
    },
    async login() { events.push('login'); if (!loginRejected) kind = 'channels'; },
    async choose() { events.push('choose-email'); selected = true; },
    async next() { events.push(kind === 'channels' ? 'request-code' : 'submit-code'); kind = kind === 'channels' ? 'code' : 'authenticated'; },
    async code() { assert.deepEqual(used, ['synthetic-message']); events.push('type-code'); },
    async show() { events.push('manual'); }
  };
  const mailbox = {
    async verify() { if (mailboxError) throw new Error('Mail unavailable'); },
    async find(_account, since, claims) { assert.equal(events.filter(e => e === 'request-code').length, 1); assert.ok(since <= time); assert.deepEqual(claims, used); time += mailDelay; return noMatch ? null : { id: 'synthetic-message', code: '123456' }; }
  };
  const options = { ui, account, mailbox, claims: { read: async () => used, claim: async id => { used.push(id); events.push('claim'); } }, now: () => time, wait: async ms => { time += ms; }, timeoutMs: 180000 };
  return { events, run: () => ensureLogin(null, { username: 'synthetic', password: 'synthetic' }, async () => {}, options) };
}
test('a fresh login chooses email once, rechecks the regenerated radio and consumes the code before typing', async () => {
  const fixture = flow(); await fixture.run();
  assert.deepEqual(fixture.events, ['login', 'choose-email', 'request-code', 'claim', 'type-code', 'submit-code']);
});
test('authenticated sessions need no credentials or email request', async () => {
  const fixture = flow({ start: 'authenticated' }); await fixture.run(); assert.deepEqual(fixture.events, []);
});
test('unanchored challenges and wrong recipients require manual completion without a code request', async () => {
  for (const options of [{ start: 'code' }, { start: 'channels' }, { wrongRecipient: true }, { mailboxError: true }]) {
    const fixture = flow(options); await assert.rejects(fixture.run(), /needs attention/);
    assert.equal(fixture.events.includes('manual'), true);
    assert.equal(fixture.events.includes('request-code'), false);
    assert.equal(fixture.events.includes('type-code'), false);
  }
});
test('missing or ambiguous email does not cause a resend, and rejected passwords are submitted only once', async () => {
  const mail = flow({ noMatch: true }); await assert.rejects(mail.run());
  assert.equal(mail.events.filter(e => e === 'request-code').length, 1);
  assert.equal(mail.events.includes('type-code'), false);
  const login = flow({ loginRejected: true }); await assert.rejects(login.run());
  assert.equal(login.events.filter(e => e === 'login').length, 1);
});
test('a mailbox response that arrives after the request window is never consumed or typed', async () => {
  const fixture = flow({ mailDelay: 160000 }); await assert.rejects(fixture.run());
  assert.equal(fixture.events.includes('claim'), false);
  assert.equal(fixture.events.includes('type-code'), false);
});
test('consumed message IDs survive restart and cannot be used twice; codes are never persisted', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'omf-login-test-'));
  try {
    await new LoginClaims(directory).claim('synthetic-message');
    const restarted = new LoginClaims(directory);
    await assert.rejects(restarted.claim('synthetic-message'), /already used/);
    assert.deepEqual(await restarted.read(), ['synthetic-message']);
    assert.equal(await readFile(path.join(directory, 'used-login-messages.json'), 'utf8'), '["synthetic-message"]');
  } finally {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test cleanup');
    await rm(directory, { recursive: true, force: true });
  }
});
