export type NaviFeatureDisposition = 'navi_tool' | 'page_handoff' | 'unsupported';
export interface NaviFeature { id: string; group: string; label: string; labelKo: string; route: string | null; disposition: NaviFeatureDisposition; reason: string; source: string; tools?: string[]; recordRoute?: string; recordSource?: string; sensitive?: boolean }
export interface CompanyNavigation { feature: string; transactionId?: string }
export const naviFeatures: readonly NaviFeature[];
export function naviFeature(id: any): NaviFeature | null;
export function naviFeatureNavigable(feature: NaviFeature | null): boolean;
export function findNaviFeatures(query?: any): NaviFeature[];
export function naviFeatureForPath(path: any): NaviFeature | null;
export function naviFeatureRoute(id: any, recordId?: any): string | null;
export interface CompanyCitation { sourceId: string; quote: string; claim: string }
export function validateCompanyAssistantReply(input: any): { kind: 'unclear' | 'defer'; summary: string; patch: Record<string, never>; quotes: Record<string, never>; navigation?: CompanyNavigation; citations?: CompanyCitation[] };
