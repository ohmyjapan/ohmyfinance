// A proposal shown to the owner (a chat proposal turn, a research report) is identified by a server-owned immutable reference:
// its kind, record id, turn or request id, record revision, a hash of the displayed content, and the purchase/draft binding
// it was displayed against. The UI freezes the displayed reference into the outbound command; the server validates it and
// stores it with that turn; the worker applies the STORED reference. Nothing here looks up a "latest" report.
import { createHash } from 'node:crypto';
export const proposalKinds = ['chat', 'research'];
const ID = /^[a-f\d]{24}$/i, TURN = /^[-a-zA-Z0-9]{16,64}$/, REQUEST = /^[a-f0-9-]{36}$/, HASH = /^[a-f0-9]{64}$/, HEX = /^[a-f0-9]+$/;
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}
export const proposalHash = content => createHash('sha256').update(canonicalJson(content)).digest('hex');
const int = (v, min = 0) => Number.isSafeInteger(v) && v >= min;
export function proposalReference({ kind, id, turnId, requestId, revision, content, importId, line, key, sourceHash, draftRevision }) {
  return validateProposalReference({ kind, id: String(id), ...(kind === 'chat' ? { turnId } : { requestId }), revision, hash: proposalHash(content), importId: String(importId), line, key, sourceHash, draftRevision });
}
export function validateProposalReference(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !proposalKinds.includes(input.kind)) throw Error('Invalid proposal reference');
  const r = { kind: input.kind, id: input.id, ...(input.kind === 'chat' ? { turnId: input.turnId } : { requestId: input.requestId }), revision: input.revision, hash: input.hash, importId: input.importId, line: input.line, key: input.key, sourceHash: input.sourceHash, draftRevision: input.draftRevision };
  if (typeof r.id !== 'string' || !ID.test(r.id) || typeof r.importId !== 'string' || !ID.test(r.importId)) throw Error('Invalid proposal reference');
  if (r.kind === 'chat' ? typeof r.turnId !== 'string' || !TURN.test(r.turnId) : typeof r.requestId !== 'string' || !REQUEST.test(r.requestId)) throw Error('Invalid proposal reference');
  if (!int(r.revision) || !int(r.line, 2) || !int(r.draftRevision) || typeof r.hash !== 'string' || !HASH.test(r.hash)) throw Error('Invalid proposal reference');
  if (typeof r.key !== 'string' || !r.key || r.key.length > 200 || typeof r.sourceHash !== 'string' || !HEX.test(r.sourceHash) || r.sourceHash.length > 128) throw Error('Invalid proposal reference');
  return r;
}
export function sameProposalReference(a, b) {
  try { return canonicalJson(validateProposalReference(a)) === canonicalJson(validateProposalReference(b)); } catch { return false; }
}
// The bounded content the reference hashes: what the owner saw, never captured source text.
export const chatProposalContent = proposal => ({ summary: proposal.summary, patch: proposal.patch });
export const researchReportContent = report => ({ summary: report.summary, findings: (report.findings || []).map(f => ({ field: f.field, value: f.value })), supplier: report.supplier ? { shopName: report.supplier.shopName, legalName: report.supplier.legalName, invoiceNumber: report.supplier.invoiceNumber } : null });
// The reference of a research row with a report (server side; the row carries its own draft/source binding in `context`).
export function researchProposalReference(research) {
  if (!research?.report || !research.context || !REQUEST.test(String(research.requestId || ''))) return null;
  try { return proposalReference({ kind: 'research', id: research._id, requestId: research.requestId, revision: research.revision, content: researchReportContent(research.report), importId: research.importId, line: research.line, key: research.context.key, sourceHash: research.context.sourceHash, draftRevision: research.context.revision }); } catch { return null; }
}
// The reference of a chat proposal turn (the conversation's recorded draft binding is the display binding).
export function chatProposalReference(chat, turn, draftRevision) {
  if (turn?.proposal?.kind !== 'proposal') return null;
  try { return proposalReference({ kind: 'chat', id: chat._id, turnId: turn.id, revision: chat.revision, content: chatProposalContent(turn.proposal), importId: chat.importId, line: chat.line, key: chat.context.key, sourceHash: chat.context.sourceHash, draftRevision }); } catch { return null; }
}
