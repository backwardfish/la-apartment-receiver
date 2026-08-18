"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { requestLiveSearch, type LiveListing } from "./live-search";
import { describeSearchIntent, parseSearchIntent, tailorListings } from "./search-intent";

type Status = "verified" | "needs-verification" | "stale";

type Listing = {
  id: string;
  title: string;
  neighborhood: string;
  city: string;
  rent: number;
  beds: number;
  baths: number;
  sqft?: number;
  available: string;
  source: string;
  sourceUrl: string;
  image: string;
  features: string[];
  status: Status;
  fit: number;
  why: string[];
  unknowns: string[];
  redFlags: string[];
};

const listings: Listing[] = [
  {
    id: "hollywood-1b",
    title: "Renovated one-bedroom with parking in the heart of Hollywood",
    neighborhood: "Hollywood",
    city: "Los Angeles",
    rent: 1995,
    beds: 1,
    baths: 1,
    available: "Available now",
    source: "L.A. Property Management Group",
    sourceUrl: "https://lapmg.appfolio.com/listings/detail/04bda8e4-5b3e-460d-a3bd-1acde252190a",
    image: "https://images.cdn.appfolio.com/lapmg/images/42c34429-6b07-49da-89b0-de341c148e15/medium.jpeg",
    features: ["Parking", "Laundry", "Dishwasher"],
    status: "needs-verification",
    fit: 94,
    why: ["Under your $2,800 ceiling", "Parking is represented in the source", "Within the Hollywood search area"],
    unknowns: ["Pet policy needs a fresh confirmation"],
    redFlags: [],
  },
  {
    id: "west-hollywood-1b",
    title: "Upper-level one-bedroom with balcony, pool, and parking",
    neighborhood: "West Hollywood",
    city: "West Hollywood",
    rent: 2595,
    beds: 1,
    baths: 1,
    available: "Available now",
    source: "L.A. Property Management Group",
    sourceUrl: "https://lapmg.appfolio.com/listings/detail/ef0d02a1-11cb-4a2c-b4f8-fee835314482",
    image: "https://images.cdn.appfolio.com/lapmg/images/a401cbf0-8b9a-4e45-b6ab-40652e0730f9/medium.jpg",
    features: ["Parking", "Laundry", "Pool", "Balcony"],
    status: "needs-verification",
    fit: 91,
    why: ["Within budget", "Parking and outdoor space are represented", "Strong amenity match"],
    unknowns: ["Exact unit and lease terms need confirmation"],
    redFlags: [],
  },
  {
    id: "inglewood-2b",
    title: "Renovated two-bedroom with patio and parking",
    neighborhood: "Inglewood",
    city: "Inglewood",
    rent: 2450,
    beds: 2,
    baths: 2,
    available: "Available now",
    source: "L.A. Property Management Group",
    sourceUrl: "https://lapmg.appfolio.com/listings/detail/feefce8a-6ca6-40f7-b8fb-9f7a5a32267e",
    image: "https://images.cdn.appfolio.com/lapmg/images/222102da-2c41-480b-9d4f-121c87952b91/medium.jpg",
    features: ["Parking", "Laundry", "Patio"],
    status: "verified",
    fit: 88,
    why: ["Under budget with two bedrooms", "Parking and laundry are represented", "Good space-to-rent tradeoff"],
    unknowns: [],
    redFlags: [],
  },
  {
    id: "santa-monica-1b",
    title: "Spacious one-bedroom in Santa Monica",
    neighborhood: "Santa Monica",
    city: "Santa Monica",
    rent: 2450,
    beds: 1,
    baths: 1,
    available: "Available now",
    source: "L.A. Property Management Group",
    sourceUrl: "https://lapmg.appfolio.com/listings/detail/fba576bf-ccfa-4e31-a0cd-34dedcbb1faf",
    image: "https://images.cdn.appfolio.com/lapmg/images/7ae8257f-3b01-43c7-ba9b-ee6675b3ab40/medium.jpg",
    features: ["Parking", "Laundry", "Dishwasher"],
    status: "needs-verification",
    fit: 86,
    why: ["Within budget", "Strong location match", "Parking is represented"],
    unknowns: ["Square footage and pet policy are not represented"],
    redFlags: [],
  },
  {
    id: "hollywood-studio",
    title: "Studio loft with two parking spaces in Hollywood",
    neighborhood: "Hollywood",
    city: "Los Angeles",
    rent: 2050,
    beds: 0,
    baths: 1,
    available: "Available now",
    source: "L.A. Property Management Group",
    sourceUrl: "https://lapmg.appfolio.com/listings/detail/c021c975-8fb4-446a-bc07-20e618a32a21",
    image: "https://images.cdn.appfolio.com/lapmg/images/c45692e9-ce84-455c-97f2-baae792cd256/medium.jpg",
    features: ["Parking", "Laundry", "Natural light", "Dishwasher"],
    status: "needs-verification",
    fit: 78,
    why: ["Comfortably under budget", "Two parking spaces represented", "Good amenity match"],
    unknowns: ["Studio layout may not meet the one-bedroom preference"],
    redFlags: ["Source snapshot currently needs fresh verification"],
  },
  {
    id: "west-hollywood-townhome",
    title: "Two-story townhouse in the West Hollywood / Hollywood area",
    neighborhood: "West Hollywood",
    city: "Los Angeles",
    rent: 3700,
    beds: 2,
    baths: 2.5,
    available: "Available now",
    source: "L.A. Property Management Group",
    sourceUrl: "https://lapmg.appfolio.com/listings/detail/572bc1c7-4bb0-40d6-b2a7-034eb8e6a6c8",
    image: "https://images.cdn.appfolio.com/lapmg/images/4221cf9d-cb5e-4fee-96cc-583f73b9b954/medium.jpg",
    features: ["Parking", "Laundry", "Air conditioning"],
    status: "verified",
    fit: 61,
    why: ["Two-bedroom layout", "Strong neighborhood match", "Parking represented"],
    unknowns: [],
    redFlags: ["Rent is $900 above your current ceiling"],
  },
];

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const STORAGE_KEY = "receiver:workspace:v1";
const VALID_IDS = new Set(listings.map((listing) => listing.id));

function presentLiveListing(listing: LiveListing): Listing {
  const isFresh = listing.freshness === "live" || listing.freshness === "recent";
  const commuteFit = listing.commute ? Math.max(0, 12 - Math.floor(listing.commute.minutes / 5)) : 0;
  const warehouseFit = Math.min(listing.warehouseSignals.length * 2, 8);
  const fit = Math.min(99, 76 + commuteFit + warehouseFit + (isFresh ? 5 : 0));

  return {
    id: listing.id,
    title: listing.title,
    neighborhood: listing.neighborhood,
    city: listing.city,
    rent: listing.rent,
    beds: listing.beds,
    baths: listing.baths,
    sqft: listing.sqft,
    available: listing.available ?? "Availability needs confirmation",
    source: listing.source,
    sourceUrl: listing.sourceUrl,
    image: listing.image ?? "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80",
    features: listing.features,
    status: isFresh ? "verified" : listing.freshness === "stale" ? "stale" : "needs-verification",
    fit,
    why: [
      ...(listing.warehouseSignals.length ? [`Warehouse character: ${listing.warehouseSignals.slice(0, 2).join(" · ")}`] : []),
      ...(listing.commute ? [`${listing.commute.minutes}-minute drive from ${listing.commute.origin} when verified`] : []),
      `Captured ${new Date(listing.capturedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    ],
    unknowns: [
      ...(listing.freshness === "needs-verification" ? ["Availability needs a fresh confirmation"] : []),
      ...(listing.commute ? [] : ["Drive time has not been verified"]),
    ],
    redFlags: [],
  };
}

type StoredWorkspace = {
  version: 1;
  saved: string[];
  rejected: string[];
  compare: string[];
  activeQuery: string;
};

function validIds(value: unknown, limit = Number.POSITIVE_INFINITY): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && VALID_IDS.has(id)))].slice(0, limit);
}

function StatusPill({ status }: { status: Status }) {
  const copy = status === "verified" ? "Verified" : status === "stale" ? "Stale" : "Needs review";
  return <span className={`status-pill status-${status}`}><span className="status-dot" />{copy}</span>;
}

function Score({ value, large = false }: { value: number; large?: boolean }) {
  return <div className={large ? "score score-large" : "score"}><span>{value}</span><small>fit</small></div>;
}

export default function Home() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [compare, setCompare] = useState<string[]>([]);
  const [filter, setFilter] = useState("All matches");
  const [sort, setSort] = useState("Best fit");
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [liveListings, setLiveListings] = useState<Listing[] | null>(null);
  const [liveSearchState, setLiveSearchState] = useState<"idle" | "loading" | "live" | "unavailable">("idle");
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | null>(null);
  const liveRequestId = useRef(0);

  const intent = useMemo(() => parseSearchIntent(activeQuery), [activeQuery]);

  useEffect(() => {
    let cancelled = false;
    let stored: Partial<StoredWorkspace> | null = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        stored = JSON.parse(raw) as Partial<StoredWorkspace>;
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }

    window.queueMicrotask(() => {
      if (cancelled) return;
      if (stored?.version === 1) {
        setSaved(validIds(stored.saved));
        setRejected(validIds(stored.rejected));
        setCompare(validIds(stored.compare, 3));
        if (typeof stored.activeQuery === "string") {
          setActiveQuery(stored.activeQuery);
          setQuery(stored.activeQuery);
        }
      }
      setWorkspaceReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!workspaceReady) return;
    const workspace: StoredWorkspace = { version: 1, saved, rejected, compare, activeQuery };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    } catch {
      // The Receiver remains usable when browser storage is unavailable.
    }
  }, [activeQuery, compare, rejected, saved, workspaceReady]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      liveRequestId.current += 1;
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const currentListings = liveListings ?? listings;
  const selected = currentListings.find((listing) => listing.id === selectedId) ?? null;
  const visibleListings = useMemo(() => {
    const tailored = liveListings ?? tailorListings(listings, intent);
    const filtered = tailored.filter((listing) => {
      if (rejected.includes(listing.id)) return false;
      if (filter === "Under $2,800" && listing.rent > 2800) return false;
      if (filter === "1+ bedroom" && listing.beds < 1) return false;
      if (filter === "Parking" && !listing.features.includes("Parking")) return false;
      if (filter === "Needs review" && listing.status === "verified") return false;
      return true;
    });
    // tailorListings ranks the natural-language request. Keep that ordering for
    // Best fit instead of immediately reverting to the snapshot's base score.
    if (sort === "Best fit") return filtered;
    return [...filtered].sort((a, b) => sort === "Lowest rent" ? a.rent - b.rent : a.id.localeCompare(b.id));
  }, [filter, intent, liveListings, rejected, sort]);

  const notify = (message: string) => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  };

  const runSearch = async (event?: FormEvent) => {
    event?.preventDefault();
    const nextQuery = query.trim();
    setActiveQuery(nextQuery);
    setFilter("All matches");
    setSort("Best fit");
    setSelectedId(null);
    if (!nextQuery) {
      setLiveListings(null);
      setLiveSearchState("idle");
      notify("Showing the full research snapshot");
      return;
    }

    const requestId = liveRequestId.current + 1;
    liveRequestId.current = requestId;
    setLiveSearchState("loading");
    try {
      const result = await requestLiveSearch(nextQuery);
      if (requestId !== liveRequestId.current) return;
      if (result.status === "ok") {
        setLiveListings(result.results.map(presentLiveListing));
        setLiveSearchState("live");
        notify(result.results.length ? `${result.results.length} live source-backed matches found` : "No live matches found for that exact brief");
        return;
      }

      setLiveListings(null);
      setLiveSearchState("unavailable");
      notify(result.message);
    } catch {
      if (requestId !== liveRequestId.current) return;
      setLiveListings(null);
      setLiveSearchState("unavailable");
      notify("Live search is temporarily unavailable. Showing the research snapshot instead.");
    }
  };

  const applySuggestion = (suggestion: string) => {
    setQuery(suggestion);
    setActiveQuery(suggestion);
    setLiveListings(null);
    setLiveSearchState("idle");
    setFilter("All matches");
    setSort("Best fit");
  };

  const toggleSaved = (id: string) => {
    setSaved((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    notify(saved.includes(id) ? "Removed from shortlist" : "Added to shortlist");
  };

  const toggleCompare = (id: string) => {
    setCompare((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 3 ? [...current, id] : current);
    notify(compare.includes(id) ? "Removed from comparison" : compare.length < 3 ? "Added to comparison" : "Comparison is full");
  };

  const rejectListing = (id: string) => {
    setRejected((current) => [...current, id]);
    if (selectedId === id) setSelectedId(null);
    notify("Hidden from this search");
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">R</span><div><strong>receiver</strong><small>apartment intelligence</small></div></div>
        <div className="sidebar-label">Workspace</div>
        <nav className="side-nav" aria-label="Primary navigation">
          <button className="side-link active"><span>⌂</span> Matches <b>{visibleListings.length}</b></button>
          <button className="side-link" onClick={() => notify(`${saved.length} saved listing${saved.length === 1 ? "" : "s"}`)}><span>♡</span> Shortlist <b>{saved.length}</b></button>
          <button className="side-link" onClick={() => setFilter("Needs review")}><span>◌</span> Needs review <b>{currentListings.filter((l) => l.status !== "verified").length}</b></button>
        </nav>
        <div className="sidebar-rule" />
        <div className="sidebar-label">Current search</div>
        <div className="search-brief">
          <div><span className="brief-icon">⌕</span><span>Los Angeles metro</span></div>
          <div><span className="brief-icon">$</span><span>Up to $2,800 / month</span></div>
          <div><span className="brief-icon">▦</span><span>1+ bedroom · parking</span></div>
          <div><span className="brief-icon">◷</span><span>Move by September 1</span></div>
        </div>
        <button className="edit-search" onClick={() => notify("Search criteria editor coming next")}>Edit criteria <span>↗</span></button>
        <div className="sidebar-footer"><span className="live-dot" /> Research snapshot loaded <small>Captured 8 Aug 2026 · demo data</small></div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="eyebrow"><span className="live-dot" /> Source-backed demo workspace</div>
          <div className="topbar-actions"><button className="icon-button" aria-label="Notifications" onClick={() => notify("No new notifications")}>♧</button><div className="avatar">A</div></div>
        </header>

        <div className="content-wrap">
          <section className="hero-row">
            <div className="hero-intro"><p className="kicker">Your search starts here</p><h1>What are you looking for <em>today?</em></h1><p className="hero-copy">Describe the place, neighborhood, budget, or tradeoffs that matter right now. Receiver will tailor this research snapshot to your request.</p></div>
          </section>

          <form className="intent-search" onSubmit={runSearch}>
            <span className="intent-icon" aria-hidden="true">⌕</span>
            <label className="sr-only" htmlFor="apartment-intent">Describe the apartment you want</label>
            <textarea id="apartment-intent" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try: A quiet one-bedroom in West Hollywood under $2,800 with parking" rows={2} />
            <button type="submit" disabled={liveSearchState === "loading"}>{liveSearchState === "loading" ? "Researching…" : "Tailor my search"} <span>→</span></button>
          </form>
          <div className="intent-suggestions" aria-label="Example searches">
            <span>Try</span>
            {["West Hollywood under $2,800", "1 bedroom with parking", "Santa Monica with laundry"].map((suggestion) => <button key={suggestion} onClick={() => applySuggestion(suggestion)}>{suggestion}</button>)}
          </div>
          {activeQuery && <div className="active-intent"><span>✦ Tailored for</span><strong>{describeSearchIntent(intent)}</strong><button onClick={() => { setQuery(""); setActiveQuery(""); setLiveListings(null); setLiveSearchState("idle"); }}>Reset</button></div>}

          <section className="stat-strip" aria-label="Search summary">
            <div><span className="stat-label">Best fit</span><strong>94</strong><small>score</small></div>
            <div><span className="stat-label">Median rent</span><strong>$2,450</strong><small>of visible matches</small></div>
            <div><span className="stat-label">Source-backed</span><strong>6</strong><small>research examples</small></div>
            <div><span className="stat-label">Needs review</span><strong>4</strong><small>before outreach</small></div>
          </section>

          <div className="toolbar">
            <div className="snapshot-note">{liveSearchState === "live" ? "Live provider results · verify availability before outreach" : "Captured research snapshot · not a live availability guarantee"}</div>
            <div className="toolbar-selects"><label>Show <select value={filter} onChange={(event) => setFilter(event.target.value)}><option>All matches</option><option>Under $2,800</option><option>1+ bedroom</option><option>Parking</option><option>Needs review</option></select></label><label>Sort <select value={sort} onChange={(event) => setSort(event.target.value)}><option>Best fit</option><option>Lowest rent</option><option>Newest</option></select></label></div>
          </div>

          <div className="section-heading"><div><span className="section-kicker">Receiver feed</span><h2>Strongest matches <span>{visibleListings.length}</span></h2></div><div className="feed-note"><span className="evidence-icon">✦</span> Every card keeps its source</div></div>

          {visibleListings.length === 0 ? <div className="empty-state"><span>⌕</span><h3>{liveSearchState === "live" ? "No live matches for that exact brief" : "No snapshot matches that request"}</h3><p>{liveSearchState === "live" ? "Try widening the area, budget, or one requirement." : "Try widening the budget or removing one requirement. A live research run is the next connected capability."}</p><button onClick={() => { setFilter("All matches"); setQuery(""); setActiveQuery(""); setLiveListings(null); setLiveSearchState("idle"); }}>Reset search</button></div> : <div className="listing-grid">{visibleListings.map((listing) => <article className="listing-card" key={listing.id}>
            <button className="card-image" onClick={() => setSelectedId(listing.id)} aria-label={`Open ${listing.title}`}><img src={listing.image} alt="" /><span className="image-fade" /><span className="source-chip">{listing.source === "L.A. Property Management Group" ? "LAPMG" : listing.source}</span><span className="image-status"><StatusPill status={listing.status} /></span><span className="open-hint">Open details ↗</span></button>
            <div className="card-body"><div className="card-topline"><span className="card-location">{listing.neighborhood} <i>·</i> {listing.city}</span><Score value={listing.fit} /></div><button className="card-title" onClick={() => setSelectedId(listing.id)}>{listing.title}</button><div className="card-facts"><strong>{money.format(listing.rent)}</strong><span>/ mo</span><i>·</i><span>{listing.beds === 0 ? "Studio" : `${listing.beds} bed`}</span><i>·</i><span>{listing.baths} bath</span></div><div className="feature-row">{listing.features.slice(0, 3).map((feature) => <span key={feature}>{feature}</span>)}</div><div className="card-actions"><button className={saved.includes(listing.id) ? "action-button saved" : "action-button"} onClick={() => toggleSaved(listing.id)}>{saved.includes(listing.id) ? "♥ Saved" : "♡ Save"}</button><button className={compare.includes(listing.id) ? "action-button selected" : "action-button"} onClick={() => toggleCompare(listing.id)}>{compare.includes(listing.id) ? "✓ Comparing" : "+ Compare"}</button><button className="more-button" onClick={() => setSelectedId(listing.id)} aria-label="More actions">•••</button></div></div>
          </article>)}</div>}

          <section className="trust-band"><div className="trust-symbol">✦</div><div><strong>What “verified” means here</strong><p>Source facts are captured from the original listing page. A fresh page capture is not a guarantee of availability, so “needs review” stays visible until you confirm it.</p></div><button onClick={() => notify("Verification policy opened")}>Read policy ↗</button></section>
        </div>
      </section>

      {selected && <div className="drawer-backdrop" onClick={() => setSelectedId(null)}><aside className="detail-drawer" role="dialog" aria-modal="true" aria-label={`${selected.title} details`} onClick={(event) => event.stopPropagation()}><button className="drawer-close" onClick={() => setSelectedId(null)} aria-label="Close details">×</button><div className="drawer-photo"><img src={selected.image} alt="" /><span className="drawer-photo-count">1 source image</span></div><div className="drawer-content"><div className="drawer-kicker"><StatusPill status={selected.status} /><span>Snapshot captured 8 Aug 2026</span></div><h2>{selected.title}</h2><p className="drawer-address">{selected.neighborhood}, {selected.city} <span>·</span> Los Angeles metro</p><div className="drawer-rent"><strong>{money.format(selected.rent)}</strong><span>/ month</span><Score value={selected.fit} large /></div><div className="drawer-grid"><div><small>Layout</small><strong>{selected.beds === 0 ? "Studio" : `${selected.beds} bed`} · {selected.baths} bath</strong></div><div><small>Availability</small><strong>{selected.available} when captured</strong></div><div><small>Source</small><strong>{selected.source}</strong></div><div><small>Evidence</small><strong>Original page linked</strong></div></div><div className="drawer-section"><h3>Why it matches</h3><ul className="why-list">{selected.why.map((item) => <li key={item}><span>✓</span>{item}</li>)}</ul></div>{selected.unknowns.length > 0 && <div className="drawer-section caution"><h3>Needs confirmation</h3><ul>{selected.unknowns.map((item) => <li key={item}>{item}</li>)}</ul></div>}{selected.redFlags.length > 0 && <div className="drawer-section warning"><h3>Watch-outs</h3><ul>{selected.redFlags.map((item) => <li key={item}>{item}</li>)}</ul></div>}<div className="drawer-section"><h3>Features</h3><div className="drawer-features">{selected.features.map((feature) => <span key={feature}>{feature}</span>)}</div></div><div className="drawer-actions"><button className="primary-action" onClick={() => notify("Demo only — inquiry drafting is not connected yet")}>Preview inquiry step</button><button className="secondary-action" onClick={() => toggleSaved(selected.id)}>{saved.includes(selected.id) ? "♥ Saved" : "♡ Save to shortlist"}</button><button className="secondary-action" onClick={() => rejectListing(selected.id)}>Hide from this search</button><a className="source-link" href={selected.sourceUrl} target="_blank" rel="noreferrer">Open original source ↗</a></div><p className="drawer-footnote">No message will be sent and no form will be submitted from this demo.</p></div></aside></div>}
      {compare.length > 0 && <div className="compare-tray"><div><strong>{compare.length} selected for comparison</strong><span>{compare.map((id) => currentListings.find((listing) => listing.id === id)?.neighborhood).filter(Boolean).join(" · ")}</span></div><button onClick={() => notify("Comparison view is ready for the next Receiver milestone")}>Compare now ↗</button><button className="tray-close" onClick={() => setCompare([])} aria-label="Clear comparison">×</button></div>}
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}
