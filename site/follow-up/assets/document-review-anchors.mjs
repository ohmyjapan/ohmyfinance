export const normalizeQuote = value => value.trim().replace(/\s+/g, ' ');

export function documentBlocks(section) {
  return [...section.paragraphs, ...(section.table?.headers || []), ...(section.table?.rows.flat() || [])];
}

export function selectionExcerpt(section, anchor) {
  if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) return '';
  const {startBlock, startOffset, endBlock, endOffset} = anchor;
  if (![startBlock, startOffset, endBlock, endOffset].every(value => Number.isSafeInteger(value) && value >= 0)) return '';
  const blocks = documentBlocks(section);
  if (startBlock > endBlock || endBlock >= blocks.length || startOffset > blocks[startBlock].length ||
      endOffset > blocks[endBlock].length || (startBlock === endBlock && startOffset >= endOffset)) return '';
  const selected = blocks.slice(startBlock, endBlock + 1).map((text, i) => text.slice(
    i === 0 ? startOffset : 0, i + startBlock === endBlock ? endOffset : text.length
  ));
  return normalizeQuote(selected.join(' ')).slice(0, 400).trimEnd();
}
