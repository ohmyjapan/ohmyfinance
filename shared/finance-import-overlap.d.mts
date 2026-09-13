export interface SourceReference { fingerprint: string; lines: number[]; state: 'existing_import' | 'source_overlap_review'; targets: { importId: string; sourceHash: string; lines: number[] }[] }
export function sourceReferenceGroups(batch: any): SourceReference[];
export function buildSourceReferences(batch: any, previous: any[]): { version: number; sourceHash: string; groups: SourceReference[] };
export function verifySourceReferences(batch: any, targets: any[]): SourceReference[];
export function activeImportRows(batch: any): any[];
export function sourceReferenceAt(batch: any, line: number): SourceReference | null;
export function purposeEvidence(values: any, evidence: any): { state: string; source: string; grade: string; reason: string };
