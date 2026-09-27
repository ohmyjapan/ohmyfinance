export type AssistantPage = 'dashboard' | 'mapping' | 'draft' | 'learning' | 'transactions' | 'connections' | 'settings' | 'reports' | 'other';
export const assistantPages:Record<AssistantPage,string>;
export function assistantPage(path:string):AssistantPage;
export function assistantTarget(value:any):any;
export function validateAssistantReply(input:any):any;
