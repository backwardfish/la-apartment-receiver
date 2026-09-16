import { trustedUrl } from './security-urls.ts';

export type PersistedListing = {
  id: string; title: string; neighborhood: string; city: string;
  rent: number; beds: number; baths: number; sqft?: number;
  available: string; source: string; sourceUrl: string; image: string;
  features: string[]; status: 'verified' | 'needs-verification' | 'stale';
  capturedAt?: string; lastSeenAt?: string; fit: number;
  why: string[]; unknowns: string[]; redFlags: string[];
  warehouseSignals?: string[];
  styleGrade?: 'A' | 'B' | 'C' | 'D'; cautions?: string[]; yearBuilt?: number; listedDaysAgo?: number;
  area?: string; distanceMiles?: number;
};
export type Workspace = {
  saved: string[]; rejected: string[]; compare: string[]; activeQuery: string;
  liveListings: PersistedListing[] | null;
  retainedListings?: PersistedListing[];
};
export const STORAGE_KEY = 'receiver:workspace:v4';
const LEGACY_KEYS = ['receiver:workspace:v3', 'receiver:workspace:v2'];
const MAX_BYTES = 500_000;
const RETENTION_MS = 30 * 86_400_000;
function text(value: unknown): value is string { return typeof value === 'string' && value.length <= 2048; }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function stringArray(value: unknown): value is string[] { return Array.isArray(value) && value.length <= 40 && value.every(text); }
function timestamp(value: unknown): string | undefined { return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined; }

export function sanitizePersistedListings(value: unknown): PersistedListing[] | null {
  if (!Array.isArray(value)) return null;
  const result: PersistedListing[] = [];
  const ids = new Set<string>();
  for (const item of value.slice(0, 103)) {
    if (!item || typeof item !== 'object') continue;
    const l = item as Record<string, unknown>;
    if (![l.id,l.title,l.neighborhood,l.city,l.available,l.source].every(text) || !finite(l.rent) || !finite(l.beds) || !finite(l.baths) || !finite(l.fit) || !stringArray(l.features) || !stringArray(l.why) || !stringArray(l.unknowns) || !stringArray(l.redFlags)) continue;
    const sourceUrl = trustedUrl(l.sourceUrl,'sources'), image = trustedUrl(l.image,'images');
    if (!sourceUrl || !image || !['verified','needs-verification','stale'].includes(String(l.status)) || ids.has(String(l.id))) continue;
    ids.add(String(l.id));
    // Reconstruct an allowlist; never persist unknown provider fields, tokens, or account data.
    const clean: PersistedListing = {id:String(l.id), title:String(l.title), neighborhood:String(l.neighborhood), city:String(l.city), rent:l.rent, beds:l.beds, baths:l.baths, available:String(l.available), source:String(l.source), sourceUrl,image,features:l.features,status:l.status==='stale'?'stale':'needs-verification',fit:Math.min(l.fit,99),why:l.why,unknowns:l.unknowns,redFlags:l.redFlags};
    if (finite(l.sqft)) clean.sqft = l.sqft;
    const capturedAt=timestamp(l.capturedAt),lastSeenAt=timestamp(l.lastSeenAt);
    if(capturedAt)clean.capturedAt=capturedAt;
    if(lastSeenAt)clean.lastSeenAt=lastSeenAt;
    if(stringArray(l.warehouseSignals))clean.warehouseSignals=l.warehouseSignals;
    if(['A','B','C','D'].includes(String(l.styleGrade)))clean.styleGrade=l.styleGrade as PersistedListing['styleGrade'];
    if(stringArray(l.cautions))clean.cautions=l.cautions;
    if(finite(l.yearBuilt)&&l.yearBuilt>1600&&l.yearBuilt<2100)clean.yearBuilt=l.yearBuilt;
    if(finite(l.listedDaysAgo)&&l.listedDaysAgo<=100000)clean.listedDaysAgo=l.listedDaysAgo;
    if(text(l.area)&&l.area.length<=80)clean.area=l.area;
    if(finite(l.distanceMiles)&&l.distanceMiles<=1000)clean.distanceMiles=l.distanceMiles;
    result.push(clean);
  }
  return result;
}
/** Keep the evidence for selected listings independently of the current search. */
export function retainWorkspaceListings(previous: PersistedListing[], current: PersistedListing[], ids: string[]): PersistedListing[] {
  const byId = new Map([...previous, ...current].map(listing => [listing.id, listing]));
  return sanitizePersistedListings([...new Set(ids)].slice(0, 103).flatMap(id => byId.has(id) ? [byId.get(id)] : [])) ?? [];
}
export function validWorkspaceIds(value: unknown, allowed: Set<string>, limit = 100): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id):id is string=>typeof id==='string'&&allowed.has(id)))].slice(0,limit) : [];
}
function storage(): Storage | undefined { try { return globalThis.localStorage; } catch { return undefined; } }
export function storageAvailable(): boolean {
  try { const s=storage(); if(!s)return false;s.setItem('receiver:probe','1');s.removeItem('receiver:probe');return true; } catch { return false; }
}
export function clearWorkspace(): boolean {
  try { const s=storage(); if(!s)return false;for(const key of [STORAGE_KEY,...LEGACY_KEYS])s.removeItem(key);return true; } catch { return false; }
}
export function restoreWorkspace(snapshots: PersistedListing[], now=Date.now()): Workspace | null {
  try {
    const s=storage();const raw=[STORAGE_KEY,...LEGACY_KEYS].map(key=>s?.getItem(key)).find(Boolean);
    if(!raw)return null;
    if(new TextEncoder().encode(raw).length>MAX_BYTES){clearWorkspace();return null;}
    const value=JSON.parse(raw);
    if(!value||![2,3,4].includes(value.version))return null;
    if(value.version>=3&&(!finite(value.savedAt)||value.savedAt>now+300000||now-value.savedAt>RETENTION_MS)){clearWorkspace();return null;}
    const liveListings=sanitizePersistedListings(value.liveListings);
    const retainedListings=sanitizePersistedListings(value.retainedListings)??[];
    for(const listing of [...(liveListings??[]),...retainedListings])if(listing.capturedAt&&now-Date.parse(listing.capturedAt)>7*86400000)listing.status='stale';
    const allowed=new Set([...snapshots,...(liveListings??[]),...retainedListings].map(l=>l.id));
    const saved=validWorkspaceIds(value.saved,allowed),compare=validWorkspaceIds(value.compare,allowed,3);
    const retained=retainWorkspaceListings(retainedListings,[...snapshots,...(liveListings??[])],[...saved,...compare]);
    return {liveListings,retainedListings:retained,saved,rejected:validWorkspaceIds(value.rejected,allowed),compare,activeQuery:typeof value.activeQuery==='string'?value.activeQuery.slice(0,500):''};
  } catch { clearWorkspace();return null; }
}
export function persistWorkspace(workspace: Workspace, now=Date.now()): boolean {
  try {
    const liveListings=sanitizePersistedListings(workspace.liveListings);
    const saved=workspace.saved.slice(0,100),compare=workspace.compare.slice(0,3);
    const retainedListings=retainWorkspaceListings(workspace.retainedListings??[],liveListings??[],[...saved,...compare]);
    const clean={version:4,savedAt:now,saved,rejected:workspace.rejected.slice(0,100),compare,activeQuery:workspace.activeQuery.slice(0,500),liveListings,retainedListings};
    const raw=JSON.stringify(clean);if(new TextEncoder().encode(raw).length>MAX_BYTES)return false;
    const s=storage();if(!s)return false;s.setItem(STORAGE_KEY,raw);for(const key of LEGACY_KEYS)s.removeItem(key);return true;
  } catch { return false; }
}
