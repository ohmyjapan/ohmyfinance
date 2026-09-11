export const learningVersion: number;
export const norm: (value: unknown) => string;
export const hash: (value: string | Buffer) => string;
export const sourceUrl: (value: string) => string;
export const validDate: (value: unknown) => boolean;
export const gradePattern: (customers: any[], total: number) => string;
export const classification: (label: string, aliases: any[]) => {purpose:string;customerId:string};
export const aggregatePatterns: (rows: any[]) => any[];
export const decisionInput: (body: any) => any;
