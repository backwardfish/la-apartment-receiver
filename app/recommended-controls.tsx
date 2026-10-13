'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sanitizePersistedListings } from './workspace-state';
import type { DirectRegion } from './direct-sources';
import type { LiveListing } from './live-search';
type Props = { query: string; region: DirectRegion; onResults: (rows: LiveListing[], query: string, refreshedAt: string) => void };
export default function RecommendedControls({ query, region, onResults }: Props) {
  const [message, setMessage] = useState('Loading your queue…'), [busy, setBusy] = useState(false), [next, setNext] = useState('');
  const callback = useRef(onResults), controller = useRef<AbortController | null>(null);
  useEffect(() => { callback.current = onResults; }, [onResults]);
  const load = useCallback(async () => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort; setBusy(true);
    try {
      const response = await fetch('/api/recommendations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, region }), signal: abort.signal });
      const body = await response.json() as {status:string;message?:string;results:LiveListing[];refreshedAt:string;nextRefreshAt:string;stale:boolean;sources:Array<{status:string}>};
      if (abort.signal.aborted) return;
      if (!response.ok || body.status !== 'ok' || !Array.isArray(body.results)) throw new Error(body.message || 'Queue unavailable.');
      const safe = sanitizePersistedListings(body.results.map((listing: LiveListing) => ({ ...listing, available: listing.available ?? 'Confirm availability', status: 'needs-verification', fit: 0, why: [], unknowns: [], redFlags: [] }))) ?? [];
      const ids = new Set(safe.map(listing => listing.id));
      callback.current(body.results.filter((listing: LiveListing) => ids.has(listing.id)), query, body.refreshedAt);
      setNext(body.nextRefreshAt); setMessage(`${body.stale ? 'Refresh delayed. Last successful check' : 'Manager feeds refreshed'} ${new Date(body.refreshedAt).toLocaleString()}. ${body.sources.filter((source: { status: string }) => source.status === 'unavailable' || source.status === 'stale').length ? 'Some sources could not refresh; check original listings.' : ''}`);
    } catch (error) { if (!abort.signal.aborted) setMessage(error instanceof Error ? error.message : 'Queue unavailable.'); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  }, [query, region]);
  useEffect(() => {
    void load();
    // Read at the next hourly boundary and then hourly. The hosted job runs even
    // while the browser is closed; visibility catch-up handles suspended tabs.
    let interval: ReturnType<typeof setInterval> | undefined;
    const timer = setTimeout(() => { void load(); interval = setInterval(() => void load(), 3_600_000); }, 3_600_000 - Date.now() % 3_600_000 + 45_000);
    const visible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { clearTimeout(timer); if (interval) clearInterval(interval); controller.current?.abort(); document.removeEventListener('visibilitychange', visible); };
  }, [load]);
  return <section className="queue-status"><div><span className="section-kicker">Hourly discovery</span><h2>New possibilities. Your call.</h2><p>We check local managers every hour and add matches to your queue. Saves and hides personalize the order. Your current brief: <strong>{query}</strong>.</p><p role="status">{message}</p>{next && <p>Next scheduled refresh: {new Date(next).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>}</div><button className="secondary-action" disabled={busy} onClick={() => void load()}>{busy ? 'Loading…' : 'Check queue'}</button></section>;
}
