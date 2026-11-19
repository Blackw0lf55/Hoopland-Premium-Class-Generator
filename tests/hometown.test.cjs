const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const claim = value => [{ mainsnak: { datavalue: { value } } }];
const missing = () => new Response("", { status: 404 });

test("ESPN uses exact unambiguous basketball identities and prefers hometown over birthplace", async () => {
  const { default: worker } = await import("../location-worker.js");
  const original = global.fetch;
  const requested = [];
  try {
    global.fetch = async url => {
      const request = new URL(url);
      requested.push(request);
      if (request.hostname === "www.wikidata.org") return Response.json({search:[]});
      if (request.hostname.includes("espn.com") && request.pathname.includes("/search")) {
        const name = request.searchParams.get("query");
        return Response.json({results:[{id:"8001",displayName:name,sport:"basketball"}]});
      }
      if (request.pathname.includes("/athletes/8001")) return Response.json({athlete:{
        id:"8001",displayName:"Sample Origin",hometown:{city:"Paris",state:"TX",country:"USA"},
        birthPlace:{city:"Paris",state:"IL",country:"USA"}
      }});
      if (request.hostname === "geocoding-api.open-meteo.com") return Response.json({results:[
        {name:"Paris",admin1:"Illinois",country_code:"US",country:"United States",latitude:39,longitude:-87},
        {name:"Paris",admin1:"Texas",country_code:"US",country:"United States",latitude:33.66,longitude:-95.55}
      ]});
      return missing();
    };
    for (const gender of ["men","women"]) {
      const res = await worker.fetch(new Request(`https://example.test/api/hometown?name=Sample%20Origin&gender=${gender}`), {});
      const data = await res.json();
      assert.equal(data.home,"Paris, Texas");
      assert.equal(data.locationSource,"ESPN hometown");
      assert.deepEqual([data.x,data.y],[3366,-9555]);
    }
    assert.ok(requested.some(url => url.pathname.includes("womens-college-basketball/athletes/8001/overview")));
    assert.ok(requested.some(url => url.pathname.includes("mens-college-basketball/athletes/8001/overview")));
  } finally { global.fetch = original; }
});

test("birthplace variants are used only when no hometown is available", async () => {
  const { default: worker } = await import("../location-worker.js");
  const original = global.fetch;
  try {
    global.fetch = async url => {
      const request = new URL(url);
      if (request.hostname === "www.wikidata.org") return Response.json({search:[]});
      if (request.hostname === "geocoding-api.open-meteo.com") return Response.json({results:[
        {name:"Boston",admin1:"Massachusetts",country_code:"US",country:"United States",latitude:42.36,longitude:-71.06}
      ]});
      if (request.hostname === "sports.core.api.espn.com") return Response.json({
        id:"8301",displayName:"Birth Origin",placeOfBirth:{city:"Boston",state:"MA",country:"US"}
      });
      return missing();
    };
    const lookup = async params => (await (await worker.fetch(new Request(
      `https://example.test/api/hometown?${new URLSearchParams({name:"Birth Origin",gender:"men",espnId:"8301",...params})}`), {})).json());
    const espn = await lookup({});
    assert.equal(espn.home,"Boston, Massachusetts");
    assert.equal(espn.locationSource,"ESPN birthplace");
    assert.deepEqual([espn.x,espn.y],[4236,-7106]);
    const sourced = await lookup({birthplace:"Boston, MA"});
    assert.equal(sourced.locationSource,"class source birthplace");
    const hometown = await lookup({home:"Boston, MA",birthplace:"Boston, MA"});
    assert.equal(hometown.home,"Boston, MA");
    assert.equal(hometown.locationSource,"class source hometown");
  } finally { global.fetch = original; }
});

test("recruiting source columns retain hometown and birthplace labels", async () => {
  const { parseEspnRecruits } = await import("../class-sources.js");
  for (const header of ["Birthplace","Birth place","Place of birth"]) {
    const html = `<table><tr><th>Rank</th><th>Player</th><th>Hometown</th><th>${header}</th></tr>
      <tr><td>1</td><td><a href="/recruiting/player/1">Source Recruit</a></td><td>Boston, MA</td><td>Paris, France</td></tr></table>`;
    const player = parseEspnRecruits(html)[0];
    assert.equal(player.hometown,"Boston, MA");
    assert.equal(player.birthplace,"Paris, France");
  }
});

test("freshman roster identity supplies hometowns and distinguishes team, season, and gender", async () => {
  const { default: worker } = await import("../location-worker.js");
  const original = global.fetch;
  try {
    global.fetch = async url => {
      const request = new URL(url);
      if (request.hostname === "www.wikidata.org") return Response.json({search:[]});
      const id = request.pathname.match(/\/teams\/(\d+)\/roster$/)?.[1];
      if (id) return Response.json({
        team:{id},season:{year:id === "7103" ? 2035 : 2026},athletes:[{
          id:"8101",displayName:"Roster Origin",
          hometown:{city:id === "7101" ? "Boston" : "Toronto",state:id === "7101" ? "MA" : "Ontario",country:id === "7101" ? "USA" : "Canada"},
          birthPlace:{city:"Chicago",state:"IL",country:"USA"}
        }]
      });
      if (request.hostname === "geocoding-api.open-meteo.com") {
        const city = request.searchParams.get("name");
        return Response.json({results: city === "Boston"
          ? [{name:city,admin1:"Massachusetts",country_code:"US",country:"United States",latitude:42.36,longitude:-71.06}]
          : [{name:city,admin1:"Ontario",country_code:"CA",country:"Canada",latitude:43.65,longitude:-79.38}]});
      }
      assert.ok(!request.pathname.includes("/search"),"unverified recruits must not use name-only ESPN search");
      return missing();
    };
    for (const gender of ["men","women"]) {
      const lookup = async team => (await (await worker.fetch(new Request(
        `https://example.test/api/hometown?name=Roster%20Origin&gender=${gender}&recruit=1&recruitYear=2025&team=${team}`), {})).json());
      const first = await lookup("7101");
      const second = await lookup("7102");
      const wrongSeason = await lookup("7103");
      assert.equal(first.home,"Boston, Massachusetts");
      assert.deepEqual([first.x,first.y],[4236,-7106]);
      assert.equal(second.home,"Toronto, Ontario, Canada");
      assert.equal(second.countryName,"Canada");
      assert.equal(wrongSeason.home,undefined);
    }
  } finally { global.fetch = original; }
});

test("geocoding never substitutes another state or country, and preserves a sourced hometown", async () => {
  const { default: worker } = await import("../location-worker.js");
  const original = global.fetch;
  try {
    global.fetch = async url => {
      const request = new URL(url);
      if (request.hostname === "www.wikidata.org") return Response.json({search:[]});
      if (request.hostname.includes("espn.com") && request.pathname.includes("/search")) return Response.json({results:[]});
      if (request.hostname === "geocoding-api.open-meteo.com") return Response.json({results:[
        {name:"Paris",admin1:"Texas",country_code:"US",country:"United States",latitude:33,longitude:-95},
        {name:"Paris",admin1:"Ontario",country_code:"CA",country:"Canada",latitude:43,longitude:-80}
      ]});
      return missing();
    };
    for (const home of ["Paris, Illinois","Paris, France"]) {
      const query = new URLSearchParams({name:"Source Origin",gender:"men",home});
      const data = await (await worker.fetch(new Request(`https://example.test/api/hometown?${query}`), {})).json();
      assert.equal(data.home,home);
      assert.equal(data.locationSource,"class source hometown");
      assert.equal(data.x,undefined);
      assert.equal(data.y,undefined);
      assert.ok(data.debug.includes("geocode failed"));
      assert.equal(data.countryName,home.endsWith("Illinois") ? "United States" : "France");
    }
  } finally { global.fetch = original; }
});

test("ambiguous ESPN names do not choose a player or substitute a Wikidata namesake", async () => {
  const { default: worker } = await import("../location-worker.js");
  const original = global.fetch;
  try {
    global.fetch = async url => {
      const request = new URL(url);
      if (request.hostname === "www.wikidata.org") return Response.json({search:[
        {id:"Q1",label:"Ambiguous Origin",description:"basketball player"}
      ]});
      if (request.hostname.includes("espn.com") && request.pathname.includes("/search")) return Response.json({results:[
        {id:"8201",displayName:"Ambiguous Origin",sport:"basketball"},
        {id:"8202",displayName:"Ambiguous Origin",sport:"basketball"}
      ]});
      if (request.pathname.includes("/athletes/")) return Response.json({athlete:{
        displayName:"Ambiguous Origin",birthplace:{city:"Boston",state:"MA",country:"USA"}
      }});
      return missing();
    };
    const data = await (await worker.fetch(new Request("https://example.test/api/hometown?name=Ambiguous%20Origin&gender=women"), {})).json();
    assert.equal(data.home,undefined);
    assert.ok(data.debug.includes("ambiguous ESPN match"));
  } finally { global.fetch = original; }
});

test("Wikidata birthplace requires one exact basketball identity", async () => {
  const { wikidataProfile } = await import("../enrich.js");
  const original = global.fetch;
  let candidates = [];
  try {
    global.fetch = async url => {
      const request = new URL(url);
      if (request.searchParams.get("action") === "wbsearchentities") return Response.json({search:candidates});
      const id = request.searchParams.get("ids");
      if (id === "Q1") return Response.json({entities:{Q1:{claims:{P19:claim({id:"Q2"})}}}});
      if (id === "Q2") return Response.json({entities:{Q2:{labels:{en:{value:"Springfield"}},claims:{
        P625:claim({latitude:42,longitude:-72}),P17:claim({id:"Q3"}),P131:claim({id:"Q4"})
      }}}});
      return Response.json({entities:{
        Q3:{labels:{en:{value:"United States of America"}}},
        Q4:{labels:{en:{value:"Massachusetts"}}}
      }});
    };
    candidates = [{id:"Q1",label:"Wiki Origin Jr",description:"basketball player"}];
    assert.equal(await wikidataProfile("Wiki Origin"),null);
    candidates = [
      {id:"Q1",label:"Wiki Origin",description:"basketball player"},
      {id:"Q5",label:"Wiki Origin",description:"basketball player"}
    ];
    assert.equal(await wikidataProfile("Wiki Origin"),null);
    candidates.pop();
    const profile = await wikidataProfile("Wiki Origin");
    assert.equal(profile.home,"Springfield, Massachusetts");
    assert.equal(profile.lat,42);
  } finally { global.fetch = original; }
});

test("Wikidata birthplace without coordinates is geocoded using its region and country", async () => {
  const { default: worker } = await import("../location-worker.js");
  const original = global.fetch;
  try {
    global.fetch = async url => {
      const request = new URL(url);
      if (request.hostname === "geocoding-api.open-meteo.com") return Response.json({results:[
        {name:"Springfield",admin1:"Illinois",country_code:"US",country:"United States",latitude:39,longitude:-89},
        {name:"Springfield",admin1:"Massachusetts",country_code:"US",country:"United States",latitude:42,longitude:-72}
      ]});
      if (request.searchParams.get("action") === "wbsearchentities") return Response.json({search:[
        {id:"Q1",label:"Wiki No Coordinates",description:"basketball player"}
      ]});
      const id = request.searchParams.get("ids");
      if (id === "Q1") return Response.json({entities:{Q1:{claims:{P19:claim({id:"Q2"})}}}});
      if (id === "Q2") return Response.json({entities:{Q2:{labels:{en:{value:"Springfield"}},claims:{
        P17:claim({id:"Q3"}),P131:claim({id:"Q4"})
      }}}});
      if (id === "Q4|Q3") return Response.json({entities:{
        Q3:{labels:{en:{value:"United States of America"}}},
        Q4:{labels:{en:{value:"Massachusetts"}}}
      }});
      return missing();
    };
    const data = await (await worker.fetch(new Request(
      "https://example.test/api/hometown?name=Wiki%20No%20Coordinates&gender=women&recruit=1"), {})).json();
    assert.equal(data.home,"Springfield, Massachusetts");
    assert.equal(data.locationSource,"Wikidata birthplace");
    assert.deepEqual([data.x,data.y],[4200,-7200]);
  } finally { global.fetch = original; }
});

test("transformed preparation preserves the source hometown and exports its country catalog point", async () => {
  const { default: worker } = await import("../location-worker.js");
  const root = path.join(__dirname,"..");
  const html = fs.readFileSync(path.join(root,"index.html"),"utf8");
  const csv = fs.readFileSync(path.join(root,"data/location-catalog.csv"),"utf8");
  const env = {ASSETS:{fetch:async r=>new URL(r.url).pathname.endsWith(".csv")?new Response(csv):new Response(html)}};
  const transformed = await (await worker.fetch(new Request("https://example.test/"),env)).text();
  assert.ok(transformed.includes("homeCountry: sourcePlayer ? sourcePlayer.homeCountry : undefined"));
  const script=transformed.match(/<script>\nwindow\.__HOOPLAND_LOCATION_RECORDS[\s\S]*?<\/script>/)[0].slice(8,-9);
  let query;
  const c=vm.createContext({
    window:{},URL,URLSearchParams,console:{warn(){}},
    REAL_PLAYER_APPEARANCE_PROFILES:{},REAL_PLAYER_DESCRIPTIONS:{},
    normalizeAppearancePlayerName:name=>name.toLowerCase().replace(/[^a-z0-9]/g,""),
    parseLookDescription:()=>({}),
    document:{getElementById:()=>({value:"freshman"})},
    fetch:async url=>{
      query=new URL(String(url),"https://example.test").searchParams;
      return Response.json({home:"Toronto, Ontario, Canada",countryName:"Canada",x:4365,y:-7938,headshots:[]});
    }
  });

  vm.runInContext(script,c);
  const players=[{fn:"Test",ln:"Origin",hometown:"Toronto, Ontario, Canada",recruitYear:2025,espnId:"20"}];
  await c.window.__HOOPLAND_PREPARE_REAL_PLAYERS(players,"1");
  assert.equal(query.get("home"),"Toronto, Ontario, Canada");
  assert.equal(query.get("espnId"),"20");
  assert.equal(players[0].homeCountry,"Canada");
  const assigned=c.window.__HOOPLAND_RESOLVE_LOCATION({
    isReal:true,fn:"Test",ln:"Origin",home:players[0].hometown,homeCountry:players[0].homeCountry,
    homeX:players[0].homeX,homeY:players[0].homeY,ctry:"US"
  });
  assert.equal(assigned.home,"Toronto, Ontario, Canada");
  const locations=c.window.__HOOPLAND_LOCATION_RECORDS;
  assert.ok(locations.some(location=>location.country==="Canada" && location.x===assigned.loc.x && location.y===assigned.loc.y));
  const mismatched=[{fn:"Different",ln:"Origin",hometown:"Boston, MA",recruitYear:2025}];
  await c.window.__HOOPLAND_PREPARE_REAL_PLAYERS(mismatched,"1");
  assert.equal(mismatched[0].hometown,"Boston, MA");
  assert.equal(mismatched[0].homeX,undefined);
  assert.equal(mismatched[0].homeCountry,undefined);
});

test("all named catalog countries are selectable and resolve fictional players within that country", async () => {
  const {default:worker}=await import("../location-worker.js");
  const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  const csv=fs.readFileSync(path.join(__dirname,"..","data/location-catalog.csv"),"utf8");
  const env={ASSETS:{fetch:async r=>new URL(r.url).pathname.endsWith(".csv")?new Response(csv):new Response(html)}};
  const page=await (await worker.fetch(new Request("https://example.test/"),env)).text();
  const script=page.match(/<script>\nwindow\.__HOOPLAND_LOCATION_RECORDS[\s\S]*?<\/script>/)[0].slice(8,-9);
  const context=vm.createContext({window:{},console:{warn(){}}});
  vm.runInContext(script,context);
  const code=html.slice(html.indexOf("const NBA_COUNTRY_COUNTS = {"),html.indexOf("const NAMES = {"));
  const countries=vm.runInNewContext(code+"\nCOUNTRIES");
  const overrides={BA:"Bosnia and Herzegovina",HK:"Hong Kong",PS:"Palestine",TT:"Trinidad and Tobago",TR:"Turkey"};
  const region=new Intl.DisplayNames(["en"],{type:"region"});
  const names=new Set();
  for(const [code] of countries){
    const name=overrides[code]||region.of(code==="UK"?"GB":code);
    const candidates=context.window.__HOOPLAND_LOCATION_RECORDS.filter(location=>location.country===name);
    if(code==="BE"){assert.equal(candidates.length,0);continue;}
    assert.ok(candidates.length>0,`${code}: ${name}`);
    names.add(name);
    const location=context.window.__HOOPLAND_RESOLVE_LOCATION({ctry:code}).loc;
    assert.ok(candidates.some(item=>item.x===location.x&&item.y===location.y),code);
  }
  const catalogNames=new Set(context.window.__HOOPLAND_LOCATION_RECORDS.map(location=>location.country));
  assert.deepEqual([...catalogNames].filter(name=>!names.has(name)),[]);
});
