export const PUBLIC_RESEARCH_VERSION: 1;
export const publicResearchLimits: Readonly<{ textChars: number; toolTextChars: number; readWindow: number; sourcesPerTurn: number; citations: number; quoteChars: number; claimChars: number; titleChars: number; urlChars: number; safeErrorChars: number; detailChars: number }>;
export const tNumberPattern: RegExp;
export interface PublicResearchTool { name: string; description: string; inputSchema: { type: 'object'; additionalProperties: false; properties: Record<string, any>; required?: string[] } }
export function publicResearchTools(options?: { chrome?: boolean }): PublicResearchTool[];
export const citationSchema: Readonly<Record<string, any>>;
export interface PublicResearchCapability { version: 1; webSearch: boolean; publicPage: true; chrome: boolean; registry: 'configured' | 'connection_required' }
export function validatePublicCapability(input: any): PublicResearchCapability;
export interface CompanyCitationInput { sourceId: string; quote: string; claim: string }
export function validateCompanyCitations(input: any): CompanyCitationInput[];
export function literalQuoteIn(text: any, quote: any): boolean;
export function registryUrl(number: string, day: string): string;
export function isRegistryHost(hostname: any): boolean;
export type PublicEvidence = 'published_page' | 'official_registry_observation';
export function evidenceOf(kind: string): PublicEvidence;
export function publicSourceUrl(value: any): boolean;
export interface RegistryTarget { number: string; transactionId?: string; invoiceId?: string; date?: string }
export function validateRegistryTarget(input: any): RegistryTarget;
export interface PublicCapture { captureId: string; kind: 'web' | 'chrome' | 'registry'; requestedUrl: string; url?: string; title?: string; text?: string; hash?: string; capturedAt?: string; truncated?: boolean; target?: RegistryTarget; failed?: true; safeError?: string; reason?: 'connection_required' }
export function validatePublicCapture(input: any): PublicCapture;
