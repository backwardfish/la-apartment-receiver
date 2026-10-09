import type { LiveListing } from './live-search.ts';
import type { SearchIntent } from './search-intent.ts';
import { parseSearchIntent } from './search-intent.ts';
import { assessStyle } from './style.ts';
import { scoreFit } from './fit.ts';
import { detectFeatures, distanceMiles, requestedAreas } from './providers.ts';
import { trustedUrl } from './security-urls.ts';
import { estimateCommuteToSantaMonica, estimatePassesLimit, isSantaMonicaCommute } from './commute-estimates.ts';

export const DIRECT_SOURCES = [
  { id: 'lapmg', name: 'L.A. Property Management Group', url: 'https://lapmg.appfolio.com/listings/listings' },
  { id: 'orangecountypm', name: 'Orange County Property Management', url: 'https://orangecountypm.appfolio.com/listings/listings' },
] as const;
export type DirectRegion = 'all' | 'la' | 'oc';
export type DirectSource = typeof DIRECT_SOURCES[number];
export type DirectListing = LiveListing & { county: 'la' | 'oc'; latitude: number; longitude: number };
export type SourceInventory = { version: 1; sourceId: string; checkedAt: string; listings: DirectListing[] };
export type SourceReport = { name: string; url: string; status: 'checked' | 'cached' | 'stale' | 'unavailable'; checkedAt?: string; count: number };
export type DirectFeed = { status: 'ok'; query: string; searchedAt: string; results: DirectListing[]; sources: SourceReport[]; inventoryCount: number };
export const SOURCE_TTL_MS = 6 * 60 * 60 * 1000;
export const STALE_LIMIT_MS = 24 * 60 * 60 * 1000;
const OC_CITIES = new Set(['aliso viejo','anaheim','brea','buena park','costa mesa','cypress','dana point','fountain valley','fullerton','garden grove','huntington beach','irvine','la habra','la palma','laguna beach','laguna hills','laguna niguel','laguna woods','lake forest','los alamitos','mission viejo','newport beach','orange','placentia','rancho santa margarita','san clemente','san juan capistrano','santa ana','seal beach','stanton','sunset beach','tustin','villa park','westminster','yorba linda']);
const LA_CITIES = new Set(['los angeles','west hollywood','hollywood','santa monica','culver city','beverly hills','inglewood','pasadena','south pasadena','glendale','burbank','alhambra','monterey park','long beach','torrance','redondo beach','hermosa beach','manhattan beach','el segundo','hawthorne','gardena','compton','downey','whittier','bellflower','lakewood','san pedro','venice','marina del rey','northridge','van nuys','sherman oaks','studio city','north hollywood','encino','tarzana','reseda','canoga park','woodland hills','granada hills','sylmar','sunland','tujunga','panorama city','valley village','valley glen','santa clarita','castaic','valencia','newhall','san fernando','san gabriel','monrovia','arcadia','el monte','azusa','west covina','pomona','claremont','la verne','san dimas','duarte','altadena']);
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
function plain(value: string) {
  const named: Record<string,string> = { amp:'&', quot:'"', apos:"'", lt:'<', gt:'>', nbsp:' ' };
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]*>/g,' ').replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (_,entity: string) => {
    if (!entity.startsWith('#')) return named[entity.toLowerCase()] ?? ' ';
    const n = entity.toLowerCase().startsWith('#x') ? parseInt(entity.slice(2),16) : Number(entity.slice(1));
    return n > 0 && n <= 0x10ffff && !(n>=0xd800 && n<=0xdfff) ? String.fromCodePoint(n) : ' ';
  }).replace(/\s+/g,' ').trim();
}
function field(block: string, className: string) {
  return plain(block.match(new RegExp(`<([a-z0-9]+)\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/\\1>`, 'i'))?.[2] ?? '');
}
function countyFor(city: string, zip: string): 'la' | 'oc' | undefined {
  if (OC_CITIES.has(city.toLowerCase()) && /^(926|927|928)/.test(zip)) return 'oc';
  if (LA_CITIES.has(city.toLowerCase()) && /^(900|901|902|903|904|905|906|907|908|910|911|912|913|914|915|916|917|918)/.test(zip)) return 'la';
}
/** Parse the manager's public AppFolio index. Never execute scripts or follow application links. */
export function parseAppfolioInventory(html: string, source: DirectSource, now = new Date()): SourceInventory {
  if (Buffer.byteLength(html) > 2_000_000) throw new Error('Source exceeds the size limit');
  const markerJson = html.match(/\bmarkers:\s*(\[[^\n]*\]),?\s*\n/)?.[1];
  if (!markerJson || !html.includes('js-listings-container')) throw new Error('Unrecognized source format');
  const markers: unknown = JSON.parse(markerJson);
  if (!Array.isArray(markers) || markers.length > 500) throw new Error('Invalid source markers');
  const blocks = html.split(/<div\b[^>]*class="listing-item result js-listing-item"[^>]*id="listing_/).slice(1);
  if (markers.length && !blocks.length) throw new Error('Listing format changed');
  const listings: DirectListing[] = [];
  const seen = new Set<string>();
  for (const block of blocks.slice(0,500)) {
    const internalId = Number(block.match(/^(\d+)"/)?.[1]);
    const marker = markers.find((m): m is Record<string,unknown> => !!m && typeof m === 'object' && 'listing_id' in m && m.listing_id === internalId);
    if (!marker) continue;
    const path = typeof marker.detail_page_url === 'string' ? marker.detail_page_url : '';
    if (!/^\/listings\/detail\/[0-9a-f-]{36}$/.test(path)) continue;
    const sourceUrl = trustedUrl(new URL(path, source.url).href,'sources');
    const image = trustedUrl(marker.default_photo_url,'images');
    const address = field(block,'js-listing-address');
    const cityMatch = address.match(/,\s*([^,]+),\s*CA\s+(\d{5})(?:-\d{4})?$/i);
    if (!cityMatch) continue;
    const city = titleCase(cityMatch[1]), county = countyFor(city, cityMatch[2]);
    const rentText = field(block,'js-listing-blurb-rent');
    const rent = /^\$[\d,]+(?:\.\d{2})?$/.test(rentText) ? Number(rentText.replace(/[$,]/g,'')) : NaN;
    const specs = field(block,'js-listing-blurb-bed-bath').match(/^(Studio|\d+(?:\.\d+)?)\s*(?:bd)?\s*\/\s*(\d+(?:\.\d+)?)\s*ba$/i);
    const beds = specs?.[1].toLowerCase()==='studio' ? 0 : Number(specs?.[1]);
    const baths = Number(specs?.[2]);
    const latitude = marker.latitude, longitude = marker.longitude;
    if (!sourceUrl || !image || !county || !Number.isFinite(rent) || rent <= 0 || !Number.isFinite(beds) || beds<0 || !Number.isFinite(baths) || baths<0 || typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude<33.3 || latitude>34.9 || longitude< -119 || longitude> -117.3 || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    const heading = field(block,'js-listing-title');
    const description = field(block,'js-listing-description');
    const evidence = `${heading} ${description} ${plain(block.split('listing-item__actions')[0]).split('Amenities:')[1] ?? ''}`;
    const style = assessStyle(`${heading} ${description}`);
    const features = detectFeatures(evidence);
    if (/cats allowed|(?:small )?dogs allowed/i.test(evidence) && !/no pets|pets.*not allowed/i.test(evidence) && !features.includes('Pet friendly')) features.push('Pet friendly');
    const sqft = Number(field(block,'js-listing-square-feet').replace(/Square Feet:\s*/i,'').replaceAll(',',''));
    const available = field(block,'js-listing-available');
    listings.push({ id:`direct:${source.id}:${path.split('/').at(-1)}`, title:address, city, neighborhood:city, county, latitude, longitude, rent,beds,baths, ...(sqft>0?{sqft}:{}), available:available ? `Manager lists availability: ${available}` : 'Availability not stated; check original', source:source.name,sourceUrl,image,images:[image],features, freshness:'recent', capturedAt:now.toISOString(), warehouseSignals:style.signals,styleGrade:style.grade,cautions:[...style.cautions,'Index descriptions may be abbreviated; confirm fees, amenities, and lease terms on the original.'] });
  }
  if (blocks.length && !listings.length) throw new Error('No usable source-backed listings could be parsed');
  return {version:1,sourceId:source.id,checkedAt:now.toISOString(),listings};
}

export async function fetchInventory(source: DirectSource, fetcher: typeof fetch = fetch, now = new Date()) {
  const response = await fetcher(source.url,{redirect:'error',signal:AbortSignal.timeout(12_000),headers:{accept:'text/html'}});
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html') || Number(response.headers.get('content-length'))>2_000_000) { await response.body?.cancel(); throw new Error('Source unavailable'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing source body');
  let bytes=0,html=''; const decoder=new TextDecoder('utf-8',{fatal:true});
  try { while(true) { const chunk=await reader.read(); if(chunk.done)break; bytes+=chunk.value.byteLength; if(bytes>2_000_000){await reader.cancel();throw new Error('Source too large');} html+=decoder.decode(chunk.value,{stream:true}); } html+=decoder.decode(); }
  finally {reader.releaseLock();}
  return parseAppfolioInventory(html,source,now);
}

export function directIntent(query: string): SearchIntent {
  const intent = parseSearchIntent(query);
  // OC city names stay confined to this pilot; the Zillow area selector remains unchanged.
  if (!intent.commute) {
    const oc = [...OC_CITIES].filter(city => new RegExp(`\\b${city}\\b`,'i').test(query.replace(/orange county/gi,'')));
    if (oc.length) intent.locations = [...new Set([...intent.locations.filter(x=>!oc.some(city=>x.includes(city))),...oc])];
  }
  return intent;
}
export function filterDirectListings(listings: DirectListing[], query: string, region: DirectRegion, now = new Date()) {
  const intent = directIntent(query);
  const areas = requestedAreas(intent);
  const namedCities = intent.locations.filter(key=>OC_CITIES.has(key)||LA_CITIES.has(key));
  const unknown = intent.locations.filter(key=>!areas.some(a=>a.label.toLowerCase()===key) && !namedCities.includes(key) && !requestedAreas({...intent,locations:[key]}).length && !['la','los angeles','los angeles county','orange county','oc'].includes(key));
  if(unknown.length) throw new Error('That area is not covered by the pilot. Choose LA County or Orange County, or name a supported city or LA neighborhood.');
  if(intent.commute&&!isSantaMonicaCommute(intent.commute.origin)) throw new Error('This pilot supports estimated drives to Santa Monica only. Remove the commute limit to search other destinations.');
  return listings.filter(l=>(region==='all'||l.county===region) && (!intent.locations.includes('orange county')||l.county==='oc') && (!intent.locations.includes('los angeles county')||l.county==='la'))
    .filter(l=>(intent.minRent===undefined||l.rent>=intent.minRent)&&(intent.maxRent===undefined||l.rent<=intent.maxRent)&&(intent.minBedrooms===undefined||l.beds>=intent.minBedrooms)&&intent.requiredFeatures.every(f=>l.features.includes(f)))
    .flatMap(l=>{
      const nearest=areas.map(a=>({a,d:distanceMiles(l,a)})).filter(x=>x.d<=x.a.radiusMiles).sort((a,b)=>a.d-b.d)[0];
      if((areas.length||namedCities.length)&&!nearest&&!namedCities.includes(l.city.toLowerCase()))return [];
      const listing={...l,...(nearest?{area:nearest.a.label,distanceMiles:Math.round(nearest.d*10)/10}:{}),freshness:now.getTime()-Date.parse(l.capturedAt)>SOURCE_TTL_MS?'stale' as const:l.freshness};
      if(intent.commute){const estimate=estimateCommuteToSantaMonica(listing.area ?? listing.neighborhood,listing.city);if(!estimate||!estimatePassesLimit(estimate,intent.commute.maxMinutes))return [];return [{...listing,commute:{origin:'Santa Monica',minutes:estimate.maxMinutes,range:[estimate.minMinutes,estimate.maxMinutes] as [number,number],estimated:true,verifiedAt:now.toISOString()}}];}
      return [listing];
    })
    .filter((l,index,all)=>all.findIndex(x=>x.sourceUrl===l.sourceUrl || (x.title.toLowerCase()===l.title.toLowerCase()&&x.rent===l.rent))===index)
    .sort((a,b)=>scoreFit(b,intent)-scoreFit(a,intent)||a.rent-b.rent)
    .slice(0,100);
}
