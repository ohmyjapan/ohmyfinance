export interface ForecastResolution { state: 'billed' | 'closed'; lines: number[]; target?: { importId: string; sourceHash: string; lines: number[] }; note: string; at: string; revision: number; replaced?: ForecastResolution | null }
export interface SourceReference { match?: 'pending_purchase' | 'pending_candidate' | 'pending_resolution' | string; fingerprint: string; lines: number[]; state: 'existing_import' | 'source_overlap_review'; targets: { importId: string; sourceHash: string; lines: number[] }[] }
export function sourceReferenceGroups(batch: any): SourceReference[];
export function forecastResolutions(batch: any): Map<number, ForecastResolution>;
export function buildSourceReferences(batch: any, previous: any[], history?: any[]): { version: number; sourceHash: string; groups: SourceReference[] };
export function verifySourceReferences(batch: any, targets: any[]): SourceReference[];
export function activeImportRows(batch: any): any[];
export function sourceReferenceAt(batch: any, line: number): SourceReference | null;
export function purposeEvidence(values: any, evidence: any): { state: string; source: string; grade: string; reason: string };
