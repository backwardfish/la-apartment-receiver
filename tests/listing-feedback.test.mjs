import assert from 'node:assert/strict';
import test from 'node:test';
import { isHidden, preferenceAdjustment, personalizeListing } from '../app/listing-feedback.ts';
import { persistWorkspace, restoreWorkspace, sanitizeFeedback, clearWorkspace, STORAGE_KEY } from '../app/workspace-state.ts';
const listing={id:'direct:one',title:'101 Main Street',neighborhood:'Hollywood',city:'Los Angeles',rent:2800,beds:1,baths:1,source:'Manager',sourceUrl:'https://lapmg.appfolio.com/listings/detail/test',image:'https://images.cdn.appfolio.com/image.jpg',features:['Parking','Laundry'],status:'needs-verification',available:'Confirm',fit:80,why:['Within budget'],unknowns:[],redFlags:[],styleGrade:'B'};
const other={...listing,id:'direct:two',sourceUrl:'https://lapmg.appfolio.com/listings/detail/other',rent:2900};

test('hides exact listing ids and canonical source URLs, without hiding similar units',()=>{
 const feedback=[{listing,reason:'Not for me'}];
 assert.ok(isHidden({...listing,id:'different-provider-id'},feedback));
 assert.ok(!isHidden(other,feedback));
});
test('dismissals nudge similarities; saves are positive; corrections remove their influence',()=>{
 const feedback=[{listing,reason:'Not for me'}];
 assert.ok(preferenceAdjustment(other,feedback,[])<0);
 assert.ok(preferenceAdjustment(other,[],[listing])>0);
 assert.equal(preferenceAdjustment(other,[],[]),0);
 assert.equal(preferenceAdjustment({...other,city:'Irvine',neighborhood:'Irvine',beds:3,styleGrade:'D',features:[],rent:5000},feedback,[]),0);
 const adjusted=personalizeListing(other,feedback,[]);
 assert.ok(adjusted.fit<other.fit);
 assert.match(adjusted.why[0],/saves and hides/);
 assert.equal(other.fit,80);
});
test('explicit reasons target only the selected trait and learned weights stay bounded',()=>{
 assert.equal(preferenceAdjustment({...other,rent:2500},[{listing,reason:'Price'}],[]),0);
 assert.ok(preferenceAdjustment(other,[{listing,reason:'Price'}],[])<0);
 assert.equal(preferenceAdjustment({...other,beds:2},[{listing,reason:'Layout'}],[]),0);
 assert.equal(preferenceAdjustment({...other,styleGrade:'A'},[{listing,reason:'Style'}],[]),0);
 assert.equal(preferenceAdjustment({...other,features:[]},[{listing,reason:'Amenities'}],[]),0);
 assert.equal(preferenceAdjustment({...other,city:'Irvine'},[{listing,reason:'Location'}],[]),0);
 assert.equal(preferenceAdjustment(other,Array(30).fill({listing,reason:'Style'}),[]),-8);
 assert.ok(personalizeListing({...other,fit:2},[{listing,reason:'Style'}],[]).fit>=1);
});
test('feedback sanitizes untrusted URLs, malformed records, duplicates and oversized sets',()=>{
 assert.deepEqual(sanitizeFeedback([{listing:{...listing,sourceUrl:'https://evil.test/x'},reason:'Style'},{listing,reason:'secret field'},{listing,reason:'Style'},{listing,reason:'Price'}]),[{listing,reason:'Style'}]);
 assert.equal(sanitizeFeedback(Array.from({length:120},(_,i)=>({listing:{...listing,id:`unit${i}`,sourceUrl:`https://lapmg.appfolio.com/listings/detail/unit${i}`},reason:'Style'}))).length,100);
});
test('hidden feedback survives unrelated searches and reload, then undo and clear remove it',()=>{
 const data=new Map();globalThis.localStorage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
 try {
  const workspace={saved:[],compare:[],rejected:[],activeQuery:'different search',liveListings:[],feedback:[{listing,reason:'Style'}]};
  assert.ok(persistWorkspace(workspace));
  assert.equal(JSON.parse(data.get(STORAGE_KEY)).version,6);
  const restored=restoreWorkspace([]);
  assert.ok(isHidden({...listing,id:'new-id'},restored.feedback));
  assert.ok(preferenceAdjustment(other,restored.feedback,[])<0);
  assert.ok(persistWorkspace({...restored,feedback:[]}));
  assert.deepEqual(restoreWorkspace([]).feedback,[]);
  clearWorkspace();assert.equal(restoreWorkspace([]),null);
 } finally {delete globalThis.localStorage;}
});

test('v5 saved references migrate with no invented feedback; expired feedback is removed',()=>{
 const data=new Map();globalThis.localStorage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
 try {
  const now=Date.now();
  data.set('receiver:workspace:v5',JSON.stringify({version:5,savedAt:now,saved:[listing.id],compare:[],rejected:[],activeQuery:'loft',activeNeighborhoods:['hollywood'],liveListings:[listing]}));
  const migrated=restoreWorkspace([],now);
  assert.deepEqual(migrated.saved,[listing.id]);assert.deepEqual(migrated.feedback,[]);
  assert.ok(persistWorkspace({...migrated,feedback:[{listing:other,reason:'Style'}]},now));
  assert.equal(data.has('receiver:workspace:v5'),false);
  assert.equal(restoreWorkspace([],now+31*86400000),null);
  assert.equal(data.size,0);
 } finally {delete globalThis.localStorage;}
});
