export const proposalKinds: string[];
export interface ProposalReference { kind: 'chat' | 'research'; id: string; turnId?: string; requestId?: string; revision: number; hash: string; importId: string; line: number; key: string; sourceHash: string; draftRevision: number }
export function canonicalJson(value: any): string;
export function proposalHash(content: any): string;
export function proposalReference(input: { kind: 'chat' | 'research'; id: any; turnId?: string; requestId?: string; revision: number; content: any; importId: any; line: number; key: string; sourceHash: string; draftRevision: number }): ProposalReference;
export function validateProposalReference(input: any): ProposalReference;
export function sameProposalReference(a: any, b: any): boolean;
export function chatProposalContent(proposal: any): any;
export function researchReportContent(report: any): any;
export function researchProposalReference(research: any): ProposalReference | null;
export function chatProposalReference(chat: any, turn: any, draftRevision: number): ProposalReference | null;
