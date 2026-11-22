import {selectionExcerpt} from './document-review-anchors.mjs';

const $ = id => document.getElementById(id);
const workspace = $('workspace');
const paper = $('paper');
const layout = $('reading-layout');
const notes = $('notes');
const author = $('author');
const message = $('message');
const selectionButton = $('selection-comment');
const desktop = matchMedia('(min-width: 900px)');
const wideOutline = matchMedia('(min-width: 1180px)');
const drafts = new Map();
const mount = location.pathname.match(/^\/follow-up\/[a-z0-9-]+\//)?.[0];
const dates = new Intl.DateTimeFormat('ja-JP', {dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Tokyo'});
let data, selected, active, restore, restoreRole, writer = '', sending = false;
let sections = new Map();
let candidate = null;
let dragging = false;
let selectionFrame = 0;

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
  if (!drafts.has(target.key)) drafts.set(target.key, {message:'', quote:'', anchor:null, attempt:null});
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
  if (previous) drawPassages(previous);
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
    line.dataset.commentId = item.id;
    if (item.id === active.commentId) {
      line.classList.add('is-current');
      line.tabIndex = -1;
    }
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
  drawPassages(active);
}

function openNotes(entry, passage = null, commentId = null) {
  if (sending) return;
  dismissSelection();
  if (active) clearNotes();
  active = {...entry, key:commentKey(selected, entry.section), commentId};
  if (passage) Object.assign(draftFor(active), {quote:passage.quote, anchor:passage.anchor});
  entry.block.classList.add('is-active');
  entry.button.setAttribute('aria-expanded', 'true');
  renderNotes();
  const focus = $('comment-list').querySelector('.is-current') || (writer ? message : author);
  focus.focus({preventScroll:true});
  if (!desktop.matches) notes.scrollIntoView({block:'start'});
}

function dismissSelection() {
  candidate = null;
  selectionButton.hidden = true;
  window.getSelection()?.removeAllRanges();
}

function readPassage() {
  if (!selected || sending) return null;
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  function point(node, offset) {
    const source = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest('[data-review-text]');
    if (!source || !paper.contains(source)) return null;
    const clause = source.closest('[data-section]');
    const within = document.createRange();
    within.selectNodeContents(source);
    within.setEnd(node, offset);
    return {sectionId:clause.dataset.section, block:Number(source.dataset.reviewText), offset:within.toString().length};
  }
  const start = point(range.startContainer, range.startOffset);
  const end = point(range.endContainer, range.endOffset);
  if (!start || !end || start.sectionId !== end.sectionId) return null;
  const entry = sections.get(start.sectionId);
  const anchor = {startBlock:start.block, startOffset:start.offset, endBlock:end.block, endOffset:end.offset};
  const quote = selectionExcerpt(entry.section, anchor);
  return quote ? {entry, anchor, quote, range} : null;
}

function showSelection() {
  selectionFrame = 0;
  candidate = dragging ? null : readPassage();
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  const mastBottom = document.querySelector('.masthead').getBoundingClientRect().bottom;
  const rect = candidate && [...candidate.range.getClientRects()].filter(r =>
    r.width && r.height && r.right > 0 && r.bottom > mastBottom && r.left < width && r.top < height
  ).at(-1);
  selectionButton.hidden = !rect;
  if (!rect) return;
  const {offsetWidth,offsetHeight} = selectionButton;
  const y = rect.bottom + 8 + offsetHeight < height ? rect.bottom + 8 : rect.top - offsetHeight - 8;
  selectionButton.style.left = Math.max(8, Math.min(rect.right + 10, width - offsetWidth - 8)) + 'px';
  selectionButton.style.top = Math.max(mastBottom + 6, Math.min(y, height - offsetHeight - 8)) + 'px';
}

function queueSelection() {
  if (!selectionFrame) selectionFrame = requestAnimationFrame(showSelection);
}

function drawPassages(entry) {
  const comments = commentsFor(selected, entry.section).filter(item => item.anchor);
  const draft = active?.section.id === entry.section.id && draftFor(active);
  const ranges = [...comments, ...(draft?.anchor ? [{anchor:draft.anchor}] : [])];
  for (const [index, {node,text}] of entry.blocks.entries()) {
    const spans = ranges.filter(({anchor:a}) => index >= a.startBlock && index <= a.endBlock)
      .map(item => ({item,
        start:index === item.anchor.startBlock ? item.anchor.startOffset : 0,
        end:index === item.anchor.endBlock ? item.anchor.endOffset : text.length
      })).filter(span => span.start < span.end);
    if (!spans.length) {
      if (node.childElementCount) node.textContent = text;
      continue;
    }
    const stops = [...new Set([0,text.length,...spans.flatMap(span => [span.start,span.end])])].sort((a,b)=>a-b);
    const fragment = document.createDocumentFragment();
    for (let i = 1; i < stops.length; i++) {
      const start = stops[i-1], end = stops[i], portion = text.slice(start,end);
      const covering = spans.filter(span => span.start <= start && span.end >= end);
      const match = covering.find(span => span.item.id === active?.commentId && span.item.id) ||
        covering.find(span => span.item.id) || covering[0];
      if (!match) {
        fragment.append(document.createTextNode(portion));
        continue;
      }
      const mark = element('mark',portion,'passage-mark');
      if (!match.item.id) mark.classList.add('is-draft');
      else {
        mark.dataset.commentId = match.item.id;
        mark.classList.toggle('is-active',match.item.id === active?.commentId);
        mark.setAttribute('role','button');
        mark.setAttribute('aria-label','この箇所のコメントを開く');
        mark.tabIndex = 0;
        const open = () => openNotes(entry,null,match.item.id);
        mark.addEventListener('click', () => { if (!readPassage()) open(); });
        mark.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        });
      }
      fragment.append(mark);
    }
    node.replaceChildren(fragment);
  }
}

function textBlock(node, text, blocks) {
  node.textContent = text;
  node.dataset.reviewText = String(blocks.length);
  blocks.push({node,text});
  return node;
}

function renderTable(info, blocks) {
  const table = element('table');
  const head = table.createTHead().insertRow();
  for (const label of info.headers) {
    const th = textBlock(element('th'),label,blocks);
    th.scope = 'col';
    head.append(th);
  }
  const body = table.createTBody();
  for (const row of info.rows) {
    const tr = body.insertRow();
    for (const value of row) {
      textBlock(tr.insertCell(),value,blocks);
    }
  }
  return table;
}

function chapterName(doc) {
  const label = doc.id === 'nda' ? '秘密保持契約（NDA）' : 'サービス契約書';
  return '第' + (data.documents.indexOf(doc) + 1) + '章 ' + label;
}

function chapterNavigation(doc) {
  const index = data.documents.indexOf(doc);
  const navigation = element('nav',null,'chapter-navigation');
  navigation.setAttribute('aria-label','前後の章へ移動');
  for (const [offset, label, direction] of [[-1,'← 前の章','previous'],[1,'次の章 →','next']]) {
    const target = data.documents[index + offset];
    if (!target) continue;
    const button = element('button',null,'chapter-button');
    button.type = 'button';
    button.dataset.direction = direction;
    button.append(element('span',label),element('strong',chapterName(target)));
    button.addEventListener('click', () => chooseDocument(target, true));
    navigation.append(button);
  }
  return navigation;
}

function chooseDocument(doc, focusTitle = false) {
  if (sending) return;
  dismissSelection();
  clearNotes();
  selected = doc;
  sections = new Map();
  for (const tab of $('files').querySelectorAll('[data-document]')) {
    tab.setAttribute('aria-pressed', String(tab.dataset.document === doc.id));
  }
  const title = element('h1',doc.title);
  title.tabIndex = -1;
  const clauseLinks = $('clause-links');
  clauseLinks.replaceChildren();
  $('outline-clauses').hidden = false;
  $('outline-clauses').open = wideOutline.matches;
  const meta = element('div',null,'chapter-meta');
  meta.append(element('span','第' + (data.documents.indexOf(doc) + 1) + '章','chapter-number'),element('span',doc.subtitle,'version'));
  paper.replaceChildren(meta, title, element('p',doc.notice,'notice'),
    element('p','文章を選ぶと、その箇所にコメントを付けられます。条項全体へのコメントは見出しの横から追加できます。','guide'));
  for (const section of doc.sections) {
    const block = element('section',null,'clause');
    block.dataset.section = section.id;
    const header = element('div',null,'clause-heading');
    const heading = element('h2',section.heading);
    heading.id = 'heading-' + section.id;
    block.setAttribute('aria-labelledby', heading.id);
    const link = element('a',section.heading);
    link.href = '#' + heading.id;
    link.addEventListener('click', () => { if (!wideOutline.matches) $('outline-clauses').open = false; });
    clauseLinks.append(link);
    const button = element('button','コメント','note-toggle');
    button.type = 'button';
    button.setAttribute('aria-controls','notes');
    button.setAttribute('aria-expanded','false');
    const entry = {section, block, button, blocks:[]};
    button.addEventListener('click', () => { openNotes(entry); });
    header.append(heading, button);
    block.append(header);
    for (const content of section.paragraphs) {
      block.append(textBlock(element('p'),content,entry.blocks));
    }
    if (section.table) block.append(renderTable(section.table,entry.blocks));
    sections.set(section.id, entry);
    paper.append(block);
    drawPassages(entry);
  }
  if (data.documents.length > 1) paper.append(chapterNavigation(doc));
  updateCounts();
  if (focusTitle) {
    if (location.hash) history.replaceState(null,'',location.pathname + location.search);
    title.focus({preventScroll:true});
    window.scrollTo(0,0);
  }
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
    const tab = element('button');
    tab.type = 'button';
    tab.dataset.document = doc.id;
    tab.append(element('span',chapterName(doc)),element('small'));
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
  dismissSelection();
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
  $('clause-links').replaceChildren();
  $('outline-clauses').hidden = true;
  workspace.hidden = true;
  $('sign-out').hidden = true;
  $('login').hidden = false;
  status('login-status',instruction,!!instruction);
}

function submitBusy(busy) {
  sending = busy;
  for (const control of [$('post-note'), $('sign-out'), $('close-notes'), $('remove-quote'), author, message,
    ...$('files').querySelectorAll('button'), ...paper.querySelectorAll('.note-toggle, .chapter-button')]) {
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
  draft.anchor = null;
  renderQuote(draft);
  drawPassages(active);
  message.focus();
});
desktop.addEventListener('change', placeNotes);
wideOutline.addEventListener('change', () => { $('outline-clauses').open = wideOutline.matches; });
document.addEventListener('selectionchange', queueSelection);
document.addEventListener('pointerdown', event => {
  if (event.button === 0 && event.target.closest('[data-review-text]')) {
    dragging = true;
    queueSelection();
  }
});
for (const type of ['pointerup','pointercancel']) {
  document.addEventListener(type, () => { dragging = false; queueSelection(); });
}
window.addEventListener('scroll',queueSelection,{passive:true});
window.addEventListener('resize',queueSelection);
selectionButton.addEventListener('pointerdown', event => {
  if (event.pointerType === 'mouse') event.preventDefault();
});
selectionButton.addEventListener('click', () => {
  if (candidate) openNotes(candidate.entry,candidate);
});
notes.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !sending) clearNotes(true);
});

$('note-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (sending || !active) return;
  retainDraft();
  const draft = draftFor(active);
  const payload = {documentId:selected.id, version:selected.version, sectionId:active.section.id,
    author:writer.trim(), message:draft.message.trim(), quote:draft.quote, anchor:draft.anchor};
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
