export const customerTreatments:any[];
export function customerGoodsContext(draft:any):any;
export function customerPurchaseCandidate(draft:any,treatment:string):any;
export function customerReviewBinding(draft:any,candidate:any):string;
export function customerReviewApplied(draft:any,key:string,treatment:string):boolean;
export function customerReviewGroup(context:any):string;
