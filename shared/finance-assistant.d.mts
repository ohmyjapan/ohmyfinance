export const assistantPages:Record<string,string>;
export function assistantPage(path:string):string;
export function assistantTarget(value:any):any;
export const ownerReplyLimit:number;
export function validateAssistantReply(input:any):{kind:'unclear'|'defer';summary:string;patch:Record<string,never>;quotes:Record<string,never>;navigation?:{feature:string}};
export function assistantConversationScope(actorId:any,organizationId:any,page:string):{actorId:string;organizationId:string;company:boolean;key:string};
export function assistantFeature(path:any):any;
export function validateCompanyAssistantReply(input:any):any;
