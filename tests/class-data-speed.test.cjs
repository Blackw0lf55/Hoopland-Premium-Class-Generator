const {test}=require("node:test");
const assert=require("node:assert/strict");

test("slow class sources time out and complete verified draft lists are cached", async()=>{
  const {default:worker}=await import("../location-worker.js");
  const originalFetch=global.fetch, originalCaches=global.caches, timeout=AbortSignal.timeout;
  const entries=new Map(), requests=[];
  try {
    AbortSignal.timeout=()=>timeout(25);
    global.caches={default:{
      async match(key){return entries.get(key)?.clone();},
      async put(key,response){entries.set(key,response.clone());}
    }};
    global.fetch=async (input,options)=>{
      const url=new URL(input);
      requests.push(url.hostname);
      if(url.hostname==="stats.nba.com") return new Promise((resolve,reject)=>{
        const guard=setTimeout(()=>reject(new Error("Timeout signal did not fire")),1000);
        options.signal.addEventListener("abort",()=>{clearTimeout(guard);reject(options.signal.reason);},{once:true});
      });
      if(url.hostname==="en.wikipedia.org") return new Response("",{status:503});
      if(url.hostname==="site.api.espn.com") return Response.json({
        displayName:"2025 NBA Draft",
        picks:[{overall:1,status:"SELECTION_MADE",athlete:{id:"100",displayName:"Cooper Flagg"}}]
      });
      throw new Error("Unexpected source "+url);
    };
    const request=()=>new Request("https://example.test/api/class-data?type=draft&gender=men&year=2025");
    const first=await (await worker.fetch(request(),{})).json();
    assert.equal(first.players[0].ln,"Flagg");
    assert.equal(first.source.espnDraft.complete,true);
    assert.equal(first.warning,undefined);
    assert.equal(entries.size,1);
    assert.equal([...entries.values()][0].headers.get("cache-control"),"public, max-age=604800");
    const count=requests.length;
    const cached=await worker.fetch(request(),{});
    assert.deepEqual(await cached.json(),first);
    assert.equal(cached.headers.get("cache-control"),"no-store");
    assert.equal(requests.length,count);
  } finally {global.fetch=originalFetch;global.caches=originalCaches;AbortSignal.timeout=timeout;}
});

test("incomplete or failed class lists are never cached", async()=>{
  const {default:worker}=await import("../location-worker.js");
  const originalFetch=global.fetch, originalCaches=global.caches;
  const entries=new Map();
  let requests=0, mode="complete";
  try {
    global.caches={default:{
      async match(key){return entries.get(key)?.clone();},
      async put(key,response){entries.set(key,response.clone());}
    }};
    global.fetch=async input=>{
      requests++;
      const url=new URL(input);
      if(url.hostname==="www.espn.com" && (mode==="complete" ||
          (mode==="partial" && url.pathname.includes("scnext100boys")))) {
        return new Response('<table><tr><th>Rank</th><th>Player</th></tr><tr><td>1</td><td><a href="/recruiting/player/1">Example Player</a></td></tr></table>');
      }
      return new Response("",{status:503});
    };
    const request=()=>new Request("https://example.test/api/class-data?type=freshman&gender=men&year=2025");
    const complete=await worker.fetch(request(),{});
    assert.equal(complete.status,200);
    assert.equal(entries.size,1);
    assert.equal((await complete.json()).players[0].ln,"Player");
    entries.clear(); requests=0; mode="partial";
    const partial=await worker.fetch(request(),{});
    assert.equal(partial.status,200);
    assert.match((await partial.json()).warning,/sources were unavailable/);
    assert.equal(entries.size,0);
    requests=0; mode="failed";
    assert.equal((await worker.fetch(request(),{})).status,502);
    assert.equal((await worker.fetch(request(),{})).status,502);
    assert.equal(entries.size,0);
    assert.ok(requests>=8);
  } finally {global.fetch=originalFetch;global.caches=originalCaches;}
});

test("class cache separates gender and year and uses a short lifetime for current classes", async()=>{
  const {default:worker}=await import("../location-worker.js");
  const originalFetch=global.fetch, originalCaches=global.caches;
  const entries=new Map();
  let requests=0;
  try {
    global.caches={default:{
      async match(key){return entries.get(key)?.clone();},
      async put(key,response){entries.set(key,response.clone());}
    }};
    global.fetch=async()=>{
      requests++;
      return new Response('<table><tr><th>Rank</th><th>Player</th></tr><tr><td>1</td><td><a href="/recruiting/player/1">Example Player</a></td></tr></table>');
    };
    const year=new Date().getUTCFullYear();
    const request=(gender,y)=>new Request(`https://example.test/api/class-data?type=freshman&gender=${gender}&year=${y}`);
    for(const [gender,y] of [["men",year],["women",year],["men",year+1]])
      assert.equal((await worker.fetch(request(gender,y),{})).status,200);
    assert.equal(entries.size,3);
    assert.ok([...entries.values()].every(response=>response.headers.get("cache-control")==="public, max-age=3600"));
    await worker.fetch(request("men",year),{});
    assert.equal(requests,3);
  } finally {global.fetch=originalFetch;global.caches=originalCaches;}
});

test("projected recruiting and draft-history checks start together", async()=>{
  const {handleClassData}=await import("../class-sources.js");
  const originalFetch=global.fetch;
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const year=new Date().getFullYear()+1;
  let recruitingStarted=false,historyStarted=false;
  try {
    global.fetch=async input=>{
      const url=new URL(input);
      if(url.hostname==="www.espn.com"){
        recruitingStarted=true;
        await gate;
      }
      if(url.hostname==="stats.nba.com" && Number(url.searchParams.get("Season"))<year)
        historyStarted=true;
      return new Response("",{status:503});
    };
    const pending=handleClassData(new Request(`https://example.test/api/class-data?type=draft&gender=women&year=${year}`));
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(recruitingStarted,true);
    assert.equal(historyStarted,true);
    release();
    await pending;
  } finally {release();global.fetch=originalFetch;}
});

test("curated WNBA sources start together and failed required sources return an error", async()=>{
  const {default:worker}=await import("../worker.js");
  const originalFetch=global.fetch;
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const requested=[];
  try {
    global.fetch=async input=>{
      const url=new URL(input);
      requested.push(url.pathname);
      if(url.pathname.endsWith("/board")) await gate;
      return new Response("",{status:503});
    };
    const pending=worker.fetch(new Request("https://example.test/api/class-data?type=draft&gender=women&year=2026"),{});
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(requested.length,3);
    release();
    assert.equal((await pending).status,502);
  } finally {release();global.fetch=originalFetch;}
});

test("senior verification shares failed roster requests only within one class", async()=>{
  const {verifyWomenDraftSenior}=await import("../location-worker.js");
  const originalFetch=global.fetch;
  let requests=0;
  try {
    global.fetch=async()=>{requests++;await new Promise(resolve=>setTimeout(resolve,5));return new Response("",{status:503});};
    const pending=new Map();
    const players=[{fn:"One",ln:"Player",collegeTeamId:"90123"},{fn:"Two",ln:"Player",collegeTeamId:"90123"}];
    const results=await Promise.allSettled(players.map(player=>verifyWomenDraftSenior(player,2025,{},pending)));
    assert.ok(results.every(result=>result.status==="rejected"));
    assert.equal(requests,1);
    await assert.rejects(verifyWomenDraftSenior(players[0],2025,{},new Map()),/HTTP 503/);
    assert.equal(requests,2);
  } finally {global.fetch=originalFetch;}
});
