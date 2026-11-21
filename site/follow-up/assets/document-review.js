'use strict';

const $ = id => document.getElementById(id);
const workspace = $('workspace');
const paper = $('paper');
const layout = $('reading-layout');
const notes = $('notes');
const author = $('author');
const message = $('message');
const desktop = matchMedia('(min-width: 900px)');
const drafts = new Map();
const mount = location.pathname.match(/^\/follow-up\/[a-z0-9-]+\//)?.[0];
const dates = new Intl.DateTimeFormat('ja-JP', {dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Tokyo'});
let data, selected, active, restore, restoreRole, writer = '', sending = false;
let sections = new Map();

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function status(id, text, error = false) {
  const node = $(id);
  node.textContent = text;
  node.toggleAttribute('data-error', error);
}

async function api(action, payload) {
  if (!mount) throw new Error('ご案内したURLからお開きください。');
  const response = await fetch(mount + 'api/' + action, {
    cache:'no-store',
    signal:AbortSignal.timeout(12000),
    ...(payload ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)} : {})
  });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error), {status:response.status});
  return body;
}

function commentKey(doc, section) {
  return doc.id + ':' + doc.version + ':' + section.id;
}

function commentsFor(doc, section) {
  return data.comments.filter(comment => comment.documentId === doc.id && comment.version === doc.version &&
    (!section || comment.sectionId === section.id));
}

function draftFor(target) {
  if (!drafts.has(target.key)) drafts.set(target.key, {message:'', quote:'', attempt:null});
  return drafts.get(target.key);
}

function retainDraft() {
  if (!active) return;
  const draft = draftFor(active);
  draft.message = message.value;
  writer = author.value;
}

function placeNotes() {
  if (!active) return;
  if (desktop.matches) layout.append(notes);
  else active.block.append(notes);
}

function clearNotes(returnFocus = false) {
  retainDraft();
  const previous = active;
  active = null;
  notes.hidden = true;
  layout.append(notes);
  previous?.block.classList.remove('is-active');
  previous?.button.setAttribute('aria-expanded', 'false');
  $('comment-list').replaceChildren();
  $('notes-title').textContent = '';
  $('quote').textContent = '';
  message.value = '';
  author.value = '';
  status('note-status', '');
  if (returnFocus) previous?.button.focus();
}

function updateCounts() {
  for (const [id, entry] of sections) {
    const count = commentsFor(selected, {id}).length;
    entry.button.textContent = count ? 'コメント ' + count : 'コメント';
    entry.button.setAttribute('aria-label', entry.section.heading + 'のコメント' + (count ? ' ' + count + '件' : ''));
  }
  for (const tab of $('files').querySelectorAll('[data-document]')) {
    const doc = data.documents.find(item => item.id === tab.dataset.document);
    tab.querySelector('small').textContent = commentsFor(doc).length + '件';
  }
}

function renderQuote(draft) {
  $('quote-wrap').hidden = !draft.quote;
  $('quote').textContent = draft.quote;
}

function renderNotes() {
  const draft = draftFor(active);
  const comments = commentsFor(selected, active.section);
  const list = $('comment-list');
  list.replaceChildren();
  if (!comments.length) list.append(element('li','この条項にはまだコメントがありません。','comment-empty'));
  for (const item of comments) {
    const line = element('li');
    const meta = element('div',null,'comment-meta');
    meta.append(element('strong',item.author), element('span',item.role === 'admin' ? '提供側' : 'ご担当者'));
    const time = element('time',dates.format(new Date(item.createdAt)));
    time.dateTime = new Date(item.createdAt).toISOString();
    meta.append(time);
    line.append(meta);
    if (item.quote) line.append(element('blockquote',item.quote));
    line.append(element('p',item.message));
    list.append(line);
  }
  $('notes-title').textContent = active.section.heading;
  author.value = writer;
  message.value = draft.message;
  renderQuote(draft);
  status('note-status', '');
  placeNotes();
  notes.hidden = false;
}

function openNotes(entry, quotedText = '', focus = true) {
  if (sending) return;
  if (active) clearNotes();
  active = {...entry, key:commentKey(selected, entry.section)};
  if (quotedText) draftFor(active).quote = quotedText;
  entry.block.classList.add('is-active');
  entry.button.setAttribute('aria-expanded', 'true');
  renderNotes();
  if (focus) {
    const field = writer ? message : author;
    field.focus({preventScroll:true});
    if (!desktop.matches) notes.scrollIntoView({block:'start'});
  }
}

function quoteFrom(block) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return '';
  const range = selection.getRangeAt(0);
  const source = node => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest('[data-review-text]');
  const start = source(range.startContainer);
  if (!start || !block.contains(start) || source(range.endContainer) !== start) return '';
  return selection.toString().trim().replace(/\s+/g, ' ').slice(0, 400).trim();
}

function renderTable(info) {
  const table = element('table');
  const head = table.createTHead().insertRow();
  for (const label of info.headers) {
    const th = element('th',label);
    th.scope = 'col';
    th.dataset.reviewText = '';
    head.append(th);
  }
  const body = table.createTBody();
  for (const row of info.rows) {
    const tr = body.insertRow();
    for (const value of row) {
      const cell = tr.insertCell();
      cell.dataset.reviewText = '';
      cell.textContent = value;
    }
  }
  return table;
}

function chooseDocument(doc, focusTitle = false) {
  if (sending) return;
  clearNotes();
  selected = doc;
  sections = new Map();
  for (const tab of $('files').querySelectorAll('[data-document]')) {
    tab.setAttribute('aria-pressed', String(tab.dataset.document === doc.id));
  }
  const title = element('h1',doc.title);
  title.tabIndex = -1;
  paper.replaceChildren(element('span',doc.subtitle,'version'), title, element('p',doc.notice,'notice'),
    element('p','条項の「コメント」から意見を書けます。文章を選んで押すと、その箇所を引用できます。','guide'));
  for (const section of doc.sections) {
    const block = element('section',null,'clause');
    const header = element('div',null,'clause-heading');
    const heading = element('h2',section.heading);
    heading.id = 'heading-' + section.id;
    block.setAttribute('aria-labelledby', heading.id);
    const button = element('button','コメント','note-toggle');
    button.type = 'button';
    button.setAttribute('aria-controls','notes');
    button.setAttribute('aria-expanded','false');
    const entry = {section, block, button};
    let poisedQuote = '';
    button.addEventListener('pointerdown', () => { poisedQuote = quoteFrom(block); });
    button.addEventListener('click', () => { openNotes(entry, poisedQuote || quoteFrom(block)); poisedQuote = ''; });
    header.append(heading, button);
    block.append(header);
    for (const content of section.paragraphs) {
      const paragraph = element('p',content);
      paragraph.dataset.reviewText = '';
      block.append(paragraph);
    }
    if (section.table) block.append(renderTable(section.table));
    sections.set(section.id, entry);
    paper.append(block);
  }
  updateCounts();
  if (focusTitle) title.focus();
}

function enter(review) {
  if (restoreRole && restoreRole !== review.role) {
    drafts.clear();
    restore = null;
    writer = '';
  }
  restoreRole = null;
  data = review;
  $('login').hidden = true;
  workspace.hidden = false;
  $('sign-out').hidden = false;
  $('files').replaceChildren();
  for (const doc of data.documents) {
    const label = doc.id === 'nda' ? '秘密保持契約（NDA）' : 'サービス契約書';
    const tab = element('button');
    tab.type = 'button';
    tab.dataset.document = doc.id;
    tab.append(element('span',label),element('small'));
    tab.addEventListener('click', () => { if (selected !== doc) chooseDocument(doc, true); });
    $('files').append(tab);
  }
  const rememberedDoc = data.documents.find(doc => doc.id === restore?.documentId && doc.version === restore?.version);
  if (!data.documents.length) status('workspace-status','確認用の文書は準備中です。');
  else {
    status('workspace-status','');
    chooseDocument(rememberedDoc || data.documents[0]);
    const entry = rememberedDoc && sections.get(restore.sectionId);
    if (entry) openNotes(entry);
  }
  restore = null;
}

function lock(instruction, keepDrafts = false) {
  if (keepDrafts) {
    restoreRole = data?.role;
    restore = active && {documentId:selected.id, version:selected.version, sectionId:active.section.id};
  }
  clearNotes();
  if (!keepDrafts) {
    drafts.clear();
    restore = null;
    restoreRole = null;
    writer = '';
  }
  data = selected = null;
  sections.clear();
  paper.replaceChildren();
  $('files').replaceChildren();
  workspace.hidden = true;
  $('sign-out').hidden = true;
  $('login').hidden = false;
  status('login-status',instruction,!!instruction);
}

function submitBusy(busy) {
  sending = busy;
  for (const control of [$('post-note'), $('sign-out'), $('close-notes'), $('remove-quote'), author, message,
    ...$('files').querySelectorAll('button'), ...paper.querySelectorAll('.note-toggle')]) {
    control.disabled = busy;
  }
}

$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('sign-in').disabled = true;
  status('login-status','確認しています…');
  try {
    await api('login',{password:$('password').value, role:$('admin').checked ? 'admin' : 'customer'});
    $('password').value = '';
    enter(await api('document-review'));
    status('login-status','');
  } catch (error) {
    status('login-status',error.status ? error.message : '接続をご確認のうえ、もう一度お試しください。',true);
  } finally {
    $('sign-in').disabled = false;
  }
});

$('sign-out').addEventListener('click', async () => {
  $('sign-out').disabled = true;
  try {
    await api('logout',{});
    lock('');
  } catch {
    lock('ログアウトを確認できませんでした。共有端末の場合はブラウザーを閉じてください。');
  } finally {
    $('sign-out').disabled = false;
  }
});

$('close-notes').addEventListener('click', () => clearNotes(true));
$('remove-quote').addEventListener('click', () => {
  const draft = draftFor(active);
  draft.quote = '';
  renderQuote(draft);
  message.focus();
});
desktop.addEventListener('change', placeNotes);
notes.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !sending) clearNotes(true);
});

$('note-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (sending || !active) return;
  retainDraft();
  const draft = draftFor(active);
  const payload = {documentId:selected.id, version:selected.version, sectionId:active.section.id,
    author:writer.trim(), message:draft.message.trim(), quote:draft.quote};
  if (!payload.author || !payload.message) {
    status('note-status','お名前とコメントを入力してください。',true);
    return;
  }
  const signature = JSON.stringify(payload);
  if (draft.attempt?.signature !== signature) draft.attempt = {id:crypto.randomUUID(), signature};
  submitBusy(true);
  status('note-status','送信しています…');
  try {
    const result = await api('document-review',{...payload,id:draft.attempt.id});
    if (!data.comments.some(item => item.id === result.comment.id)) data.comments.push(result.comment);
    drafts.delete(active.key);
    updateCounts();
    renderNotes();
    status('note-status','コメントを追加しました。');
  } catch (error) {
    if (error.status === 401) {
      lock('ログインの期限が切れました。再度ログインすると、こちらの端末で入力中のコメントを確認できます。',true);
      $('password').focus();
    } else {
      status('note-status',error.status ? error.message : '送信を確認できませんでした。入力内容を残しています。もう一度お試しください。',true);
    }
  } finally {
    submitBusy(false);
  }
});

api('document-review').then(enter).catch(error => {
  if (error.status !== 401) status('login-status',error.status ? error.message : '接続をご確認ください。',true);
});
