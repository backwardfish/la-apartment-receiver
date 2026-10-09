"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { DirectFeed, DirectRegion, SourceReport } from './direct-sources';
import type { LiveListing } from './live-search';
import { sanitizePersistedListings } from './workspace-state';

type Props = { onResults: (listings: LiveListing[], query: string) => void };
export default function DirectSourceControls({onResults}: Props) {
  const [query,setQuery]=useState('Loft under $3,500');
  const [region,setRegion]=useState<DirectRegion>('all');
  const [state,setState]=useState<'loading'|'done'|'error'>('loading');
  const [message,setMessage]=useState('');
  const [sources,setSources]=useState<SourceReport[]>([]);
  const [inventoryCount,setInventoryCount]=useState(0);
  const [matches,setMatches]=useState(0);
  const controller=useRef<AbortController|null>(null), callback=useRef(onResults);
  useEffect(()=>{callback.current=onResults;},[onResults]);
  const load=useCallback(async (q: string, r: DirectRegion) => {
    controller.current?.abort(); const abort=new AbortController();controller.current=abort;
    setState('loading');setMessage('');setSources([]);callback.current([],q);
    try {
      const response=await fetch('/api/direct-sources',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:q,region:r}),signal:abort.signal});
      const body=await response.json() as {status?:string;message?:string;sources?:SourceReport[];results?:LiveListing[];inventoryCount?:number};
      if(abort.signal.aborted)return;
      if(Array.isArray(body.sources))setSources(body.sources);
      if(!response.ok||body.status!=='ok'||!Array.isArray(body.results))throw new Error(response.status===429?'Too many requests. Wait a minute and retry.':body.message||'Direct sources are unavailable. Try again later.');
      const feed=body as DirectFeed;
      // Use the workspace URL allowlist before rendering outbound links or photos.
      const safe=sanitizePersistedListings(feed.results.map(l=>({...l,available:l.available??'Check original',status:'needs-verification',fit:0,why:[],unknowns:[],redFlags:[]})))??[];
      const ids=new Set(safe.map(l=>l.id));
      const results=feed.results.filter(l=>ids.has(l.id));
      callback.current(results,q);setInventoryCount(feed.inventoryCount);setMatches(results.length);setState('done');
    } catch(error) {if(!abort.signal.aborted){setState('error');setMessage(error instanceof Error?error.message:'Direct sources are unavailable.');}}
  },[]);
  useEffect(()=>{void load('Loft under $3,500','all');return()=>controller.current?.abort();},[load]);
  const submit=(e: FormEvent)=>{e.preventDefault();void load(query.trim(),region);};
  return <section className="direct-pilot" aria-label="Direct source discovery">
    <div className="direct-heading"><span className="source-chip">Direct sources · pilot</span><p>Two local managers. Unit-level listings from their own rental pages. Loft character is a preference; budget and required features stay strict.</p></div>
    <form className="intent-search direct-search" onSubmit={submit}>
      <label className="direct-region">Area<select aria-label="Direct source area" value={region} onChange={e=>setRegion(e.target.value as DirectRegion)} disabled={state==='loading'}><option value="all">LA + Orange County</option><option value="la">LA County</option><option value="oc">Orange County</option></select></label>
      <textarea aria-label="Describe your direct source search" value={query} onChange={e=>setQuery(e.target.value)} rows={2} maxLength={500} required placeholder="Loft in Hollywood under $3,500 with parking"/>
      <button disabled={state==='loading'}>{state==='loading'?'Checking sources…':'Find direct listings'} →</button>
    </form>
    <div className="intent-suggestions"><span>Try</span>{['Loft under $3,500','One bedroom in Irvine under $3,000','Loft in Hollywood with parking'].map(q=><button key={q} disabled={state==='loading'} onClick={()=>{setQuery(q);setRegion('all');void load(q,'all');}}>{q}</button>)}</div>
    <div role="status" className="direct-status">{state==='loading'?'Checking the managers’ public rental pages…':state==='error'?message:`${matches} matches from ${inventoryCount} source-backed units. Source checks are reused for up to 6 hours.`}</div>
    <div className="direct-source-list">{sources.map(s=><div key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.name} ↗</a><span>{s.status==='unavailable'?'Unavailable':`${s.count} units · ${s.status==='stale'?'Refresh failed; older evidence':s.status==='cached'?'Saved source check':'Checked source'}`}</span>{s.checkedAt&&<time dateTime={s.checkedAt}>Last checked {new Date(s.checkedAt).toLocaleString()}</time>}</div>)}</div>
    <p className="direct-note">This is a two-source pilot, not a complete county search. Confirm rent, fees, and availability with the manager. Abbreviated descriptions can leave features unknown.</p>
  </section>;
}
