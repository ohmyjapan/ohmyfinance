export interface MappingRow {
  line: number; key: string; purchaseDate: string; processingDate: string; description: string;
  amount: number; cardLast4: string; purpose: 'customer' | 'company' | 'unresolved' | 'repayment' | 'credit_review';
  clientCode: string; clientName: string; category: string;
  status: 'proposed' | 'needs_client' | 'needs_category' | 'repayment' | 'credit_review'; reason: string;
  source: { sheet: string; rows: number[]; client: string; category: string; card: string } | null;
}
export function mappingRows(batch: { hash: string; rows: any[]; mappingPreview?: any }): MappingRow[];
