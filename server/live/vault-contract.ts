import type {Statement} from './db.ts';

/** A dedicated claimed vault grant, never a generic household or operator credential. */
export interface VaultAccess {
 accountId:string;roomId:string;residentId:string;agentId:string;grantId:string;
 guard:()=>Promise<Statement>;
}
export class VaultError extends Error {
 status:number;code:string;details?:Record<string,unknown>;
 constructor(status:number,code:string,details?:Record<string,unknown>){super(code);this.status=status;this.code=code;this.details=details;}
}
export const VAULT_LIMITS={fileBytes:65536,skillFiles:10,totalBytes:1048576,mutationsPerDay:100} as const;
export const VAULT_RELEASE='private-vault-v1';
