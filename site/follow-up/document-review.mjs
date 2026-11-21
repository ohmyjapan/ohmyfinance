const docIds = new Set(['nda', 'service-agreement']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const normalizeQuote = value => value.trim().replace(/\s+/g, ' ');

function readText(input, name, max, fail, required = true) {
  const value = input?.[name];
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    fail(400, 'お名前とコメントの内容をご確認ください。');
  }
  return value.trim();
}

function commentView(row) {
  return {
    id: row.id, documentId: row.document_id, version: row.version,
    sectionId: row.section_id, author: row.author, role: row.role,
    message: row.message, quote: row.quote, createdAt: row.created_at
  };
}

export async function reviewDocuments({request, db, slug, role, body, reply, fail}) {
  if (request.method === 'GET') {
    const documents = await db.prepare(
      'SELECT document_id, version, document_json FROM followup_review_documents WHERE survey_slug=? AND active=1 ORDER BY document_id'
    ).bind(slug).all();
    const comments = await db.prepare(
      `SELECT c.* FROM followup_review_comments c JOIN followup_review_documents d
        ON d.survey_slug=c.survey_slug AND d.document_id=c.document_id AND d.version=c.version
        WHERE c.survey_slug=? AND d.active=1 ORDER BY c.created_at, c.id`
    ).bind(slug).all();
    return reply({
      role,
      documents: documents.results.map(row => ({
        ...JSON.parse(row.document_json), id: row.document_id, version: row.version
      })),
      comments: comments.results.map(commentView)
    });
  }

  const input = await body(request);
  if (!docIds.has(input?.documentId) || !Number.isSafeInteger(input?.version) || input.version < 1 ||
      typeof input?.sectionId !== 'string' || !/^[a-z0-9-]{1,50}$/.test(input.sectionId) ||
      typeof input?.id !== 'string' || !uuid.test(input.id)) {
    fail(400, '条項を開き直してからコメントしてください。');
  }
  const author = readText(input, 'author', 80, fail);
  const message = readText(input, 'message', 3000, fail);
  const quote = normalizeQuote(readText(input, 'quote', 400, fail, false));
  const existingComment = () => db.prepare(
    'SELECT * FROM followup_review_comments WHERE survey_slug=? AND id=?'
  ).bind(slug, input.id).first();
  const acceptDuplicate = row => {
    const matches = row.document_id === input.documentId && row.version === input.version &&
      row.section_id === input.sectionId && row.author === author && row.message === message &&
      row.quote === quote && row.role === role;
    if (!matches) fail(409, 'コメントを開き直し、もう一度送信してください。');
    return reply({comment: commentView(row)});
  };
  const existing = await existingComment();
  if (existing) return acceptDuplicate(existing);

  const doc = await db.prepare(
    'SELECT document_json FROM followup_review_documents WHERE survey_slug=? AND document_id=? AND version=? AND active=1'
  ).bind(slug, input.documentId, input.version).first();
  if (!doc) fail(409, '文書の版が変わりました。元の文書を確認してからコメントしてください。');
  const section = JSON.parse(doc.document_json).sections.find(item => item.id === input.sectionId);
  if (!section) fail(400, 'コメントを付ける条項を選び直してください。');
  const quoteSources = [...section.paragraphs, ...(section.table?.headers || []), ...(section.table?.rows.flat() || [])];
  if (quote && !quoteSources.some(value => normalizeQuote(value).includes(quote))) {
    fail(400, '文書内の一つの段落または表のセルを選んでください。');
  }

  const saved = await db.prepare(
    `INSERT INTO followup_review_comments
      (survey_slug,id,document_id,version,section_id,author,role,message,quote,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(
        SELECT 1 FROM followup_review_documents d JOIN followup_surveys s ON s.slug=d.survey_slug
          WHERE s.active=1 AND d.active=1 AND d.survey_slug=? AND d.document_id=? AND d.version=?)
      ON CONFLICT(survey_slug,id) DO NOTHING RETURNING *`
  ).bind(slug, input.id, input.documentId, input.version, input.sectionId, author, role, message, quote,
    Date.now(), slug, input.documentId, input.version).first();
  if (saved) return reply({comment: commentView(saved)}, 201);
  const duplicate = await existingComment();
  if (duplicate) return acceptDuplicate(duplicate);
  fail(409, '文書の版が変わりました。元の文書を確認してからコメントしてください。');
}
