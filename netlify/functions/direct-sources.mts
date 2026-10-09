import type { Config, Context } from '@netlify/functions';
import { getDeployStore } from '@netlify/blobs';
import { DIRECT_SOURCES, SOURCE_TTL_MS, STALE_LIMIT_MS, fetchInventory, filterDirectListings, type SourceInventory, type SourceReport, type DirectRegion } from '../../app/direct-sources.ts';
import { boundedJson } from './search.ts';
import { release } from '../../app/release.ts';

export type InventoryCache = { get(key: string): Promise<SourceInventory | null>; put(key: string, value: SourceInventory): Promise<void> };
function cache(): InventoryCache {
  const store = getDeployStore({name:'direct-source-inventory-v1',consistency:'strong'});
  return { get:async key=>store.get(key,{type:'json'}), put:async (key,value)=>{await store.setJSON(key,value);} };
}
function usable(value: SourceInventory | null, sourceId: string, now: number): value is SourceInventory {
  return !!value && value.version===1 && value.sourceId===sourceId && Number.isFinite(Date.parse(value.checkedAt)) && now-Date.parse(value.checkedAt)>=0 && now-Date.parse(value.checkedAt)<=STALE_LIMIT_MS && Array.isArray(value.listings) && value.listings.length<=500;
}
export const createDirectSourcesHandler = (getCache: ()=>InventoryCache=cache, fetcher: typeof fetch=fetch, clock: ()=>Date=()=>new Date()) => async (request: Request, context: Context) => {
  const requestId=context?.requestId||crypto.randomUUID();
  const reply=(body: unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-receiver-release':release.revision,'x-request-id':requestId,...(status===405?{allow:'GET, POST'}:{})}});
  if(!['GET','POST'].includes(request.method))return reply({status:'unavailable',message:'Use GET or POST to search direct sources.'},405);
  let payload: unknown = {query:'loft under $3,500',region:'all'};
  if(request.method==='POST'){
    if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply({status:'unavailable',message:'Send the search as JSON.'},415);
    try{payload=await boundedJson(request);}catch(error){return reply({status:'unavailable',message:'Send a valid search under 500 characters.'},error instanceof RangeError?413:400);}
  }
  if(!payload||typeof payload!=='object'||!('query' in payload)||typeof payload.query!=='string'||!payload.query.trim()||payload.query.length>500||!('region' in payload)||!['all','la','oc'].includes(String(payload.region)))return reply({status:'unavailable',message:'Enter a search between 1 and 500 characters and choose LA County, Orange County, or both.'},400);
  const query=payload.query.trim(),region=payload.region as DirectRegion,now=clock();
  // Validate the brief before any outbound requests. The browser never supplies a source URL.
  try{filterDirectListings([],query,region,now);}catch(error){return reply({status:'unavailable',message:error instanceof Error?error.message:'Unsupported search.'},400);}
  let storage: InventoryCache | undefined;
  try{storage=getCache();}catch{/* Live reads still work if cache configuration is unavailable. */}
  const parts=await Promise.all(DIRECT_SOURCES.map(async source=>{
    let previous: SourceInventory | null=null;
    try{previous=await storage?.get(source.id)??null;}catch{/* Surface cache state separately. */}
    if(!usable(previous,source.id,now.getTime()))previous=null;
    if(previous&&now.getTime()-Date.parse(previous.checkedAt)<SOURCE_TTL_MS)return {inventory:previous,report:{name:source.name,url:source.url,status:'cached',checkedAt:previous.checkedAt,count:previous.listings.length} as SourceReport};
    try{
      const inventory=await fetchInventory(source,fetcher,now);
      try{await storage?.put(source.id,inventory);}catch{console.info(JSON.stringify({event:'direct_source_cache_unavailable',requestId,source:source.id}));}
      return {inventory,report:{name:source.name,url:source.url,status:'checked',checkedAt:inventory.checkedAt,count:inventory.listings.length} as SourceReport};
    }catch{
      console.info(JSON.stringify({event:'direct_source_unavailable',requestId,source:source.id}));
      return {inventory:previous,report:{name:source.name,url:source.url,status:previous?'stale':'unavailable',...(previous?{checkedAt:previous.checkedAt}:{}),count:previous?.listings.length??0} as SourceReport};
    }
  }));
  const sources=parts.map(p=>p.report);
  if(parts.every(p=>p.inventory===null))return reply({status:'unavailable',message:'Both direct sources are unavailable. Try again later or use Zillow search.',sources},502);
  const inventory=parts.flatMap(p=>p.inventory?.listings??[]);
  return reply({status:'ok',query,searchedAt:now.toISOString(),results:filterDirectListings(inventory,query,region,now),sources,inventoryCount:inventory.length});
};
export default createDirectSourcesHandler();
export const config: Config = {path:'/api/direct-sources',rateLimit:{windowLimit:15,windowSize:60,aggregateBy:['ip','domain']}};
