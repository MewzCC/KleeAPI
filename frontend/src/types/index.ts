export type Platform = 'gateway' | 'workbuddy' | 'trae' | 'qoder'
export interface Account {
  uid: string; nickname?: string; platform?: Platform; region?: string; enabled?: boolean; active?: boolean; status?: string;
  credits?: number; remaining?: number; unlimited?: boolean; unit?: string; used?: number; limit?: number;
  packages?: { name?: string; type?: string; remaining?: number; limit?: number; used?: number; unit?: string; expiresAt?: number | string }[];
  checkinError?: string;
  expiresAt?: number | string; email?: string; plan?: string; source?: string; providerUid?: string;
  models?: string[]; quotaError?: string; modelsError?: string; inFlight?: number;
  checkedIn?: boolean | null; message?: string; reward?: number | string; balanceBefore?: number; balanceAfter?: number;
  startsAt?: number | string; endsAt?: number | string;
  errorCode?: string; hint?: string;
  checkin?: { enabled?: boolean; checkedIn?: boolean; reward?: number | string; startsAt?: number | string; endsAt?: number | string };
}
export interface Model { id: string; name?: string; availableAccounts?: number; canonicalIds?: string[] }
export interface Snapshot { accounts: Account[]; fetchedAt?: string | number; unit?: string; warning?: string; platforms?: { platform: Platform; status?: string; error?: string }[]; models?: Model[] }
export interface Login { id: string; url: string; expiresAt?: number; status?: string }
export interface Catalog { data: Model[]; fetchedAt?: string; source?: string }
