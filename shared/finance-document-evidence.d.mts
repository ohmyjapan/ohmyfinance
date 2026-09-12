export const documentFieldLabels: Record<string,string>;
export const documentExtractionSchema: any;
export function validateDocumentExtraction(input:any):any;
export function documentReading(doc:any):any;
export function documentDisplayReading(doc:any):any;
export function matchDocumentRecords(reading:any,rows:any[],valuesByLine?:any):any[];
export function documentSuggestions(record:any):any[];
export function documentConsultation(docs:any[],evidence?:any):any[];
