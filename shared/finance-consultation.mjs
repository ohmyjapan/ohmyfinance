import { fields, isEmpty } from './finance-draft.mjs';
import { taxAndInvoice } from './finance-preparation.mjs';

const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const evidence = value => pick(value, ['state', 'source', 'reason', 'grade']);
const reference = (field, value, references) => (references[field.ref] || []).find(row => String(row._id || row.id) === String(value));
const display = (field, value, references) => field.ref && !isEmpty(value) ? reference(field, value, references)?.name || null : value;
const fieldValue = (field, value) => field.key === 'items'
  ? (value || []).map(item => pick(item, ['productName', 'janCode', 'quantity', 'unitPrice', 'taxCategoryId', 'taxRate']))
  : value ?? null;

// Only mapped values and their evidence cross the inference boundary. Reference
// credentials, document contents, product URLs and unrelated rows are excluded.
export function consultationEvidence(draft) {
  const references = draft.references || {}, source = draft.source || {};
  return {
    version: 2,
    accountingReview: taxAndInvoice(draft),
    fields: fields.map(field => {
      const value = fieldValue(field, draft.values?.[field.key]), proof = draft.evidence?.[field.key];
      const proofForReply = field.key === 'transactionCategoryId' && proof?.source === 'spreadsheet'
        && source.source && source.category && source.category !== source.source.category
        && display(field, value, references) === source.category
        ? { ...proof, source: 'annotated_mapping', reason: source.reason || 'Mapping annotation; this label differs from the original sheet.' }
        : proof;
      const presence = field.key === 'purpose' && value === 'unresolved' ? 'unresolved'
        : field.key === 'customerId' && draft.values?.purpose === 'company' && isEmpty(value) ? 'not_applicable'
        : isEmpty(value) ? 'missing' : field.ref && !reference(field, value, references) ? 'unresolved_reference' : 'present';
      return {
        key: field.key, label: field.label, value, displayValue: display(field, value, references), presence,
        evidence: evidence(proofForReply),
        ...(proof?.alternative !== undefined ? { alternative: { value: proof.alternative, displayValue: display(field, proof.alternative, references), evidence: evidence(proof.alternativeEvidence) } } : {})
      };
    }),
    sourceClassification: {
      ...pick(source, ['purpose', 'clientCode', 'clientName', 'category', 'reason']),
      originalSheet: pick(source.source, ['sheet', 'rows', 'client', 'category'])
    },
    missingRequired: (draft.missing || []).map(item => pick(item, ['key', 'label'])),
    suggestions: (draft.suggestions || []).filter(item => fields.some(field => field.key === item.field)).map(item => {
      const field = fields.find(field => field.key === item.field);
      const value = fieldValue(field, item.value);
      return { field: item.field, value, displayValue: display(field, value, references), evidence: evidence(item.evidence) };
    }),
    documents: { count: (draft.documents || []).length, contentsAvailable: false },
    saved: draft.revision > 0,
    approved: !!draft.approvedAt
  };
}
