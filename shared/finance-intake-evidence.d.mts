export type IntakeEvidenceOrigin = 'research-confirmed' | 'file-manual' | 'candidate' | 'none';
export interface IntakeEvidenceAttribution {
  origin: IntakeEvidenceOrigin;
  origins: { supplierName: IntakeEvidenceOrigin; invoiceNumber: IntakeEvidenceOrigin };
  supplierName: string;
  invoiceNumber: string;
  sourcesCurrent: boolean;
  differs: ('merchantUrl' | 'supplierName' | 'invoiceNumber')[];
}
export function intakeEvidence(values: Record<string, any> | null | undefined, research: any): IntakeEvidenceAttribution;
export function confirmedResearchCurrent(values: Record<string, any> | null | undefined, research: any): boolean;
