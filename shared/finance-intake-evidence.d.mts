export type IntakeEvidenceOrigin = 'research-confirmed' | 'file-manual' | 'candidate' | 'none';
// The day the NTA registry check was made for (registry.asOf), the record's current valid 購入日 ('' when undated or unreadable)
// and whether the check is as of that purchase (undated, or the same day).
export interface IntakeRegistryBasis { asOf: string; purchaseDate: string; current: boolean }
export interface IntakeEvidenceAttribution {
  origin: IntakeEvidenceOrigin;
  origins: { supplierName: IntakeEvidenceOrigin; invoiceNumber: IntakeEvidenceOrigin };
  supplierName: string;
  invoiceNumber: string;
  sourcesCurrent: boolean;
  differs: ('merchantUrl' | 'supplierName' | 'invoiceNumber' | 'purchaseDate')[];
  registryBasis: IntakeRegistryBasis | null;
}
export function intakeEvidence(values: Record<string, any> | null | undefined, research: any): IntakeEvidenceAttribution;
export function confirmedResearchCurrent(values: Record<string, any> | null | undefined, research: any): boolean;
