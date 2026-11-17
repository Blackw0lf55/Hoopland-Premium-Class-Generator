const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"),"utf8");
const clientCode = html.slice(html.indexOf("function proNameKey("),html.indexOf("function qualityForTier("));
const dataset = rows => ({resultSets:[{name:"LeagueDashPlayerStats",
  headers:["PLAYER_ID","PLAYER_NAME","MIN","PIE"],rowSet:rows}]});
const leagueRows = (minutes=500) => Array.from({length:20},(_,i)=>[i+1,`Player ${i+1}`,minutes,i/100]);

test("professional PIE percentiles compare eligible players within each season", async () => {
  const {professionalSeasonRows,lastCompletedSeason} = await import("../pro-stats.js");
  const input = leagueRows();
  input.push([21,"Small Sample",30,0.99],[22,"Missing PIE",800,null]);
  const rows = professionalSeasonRows(dataset(input),"men");
  assert.equal(rows.length,21);
  assert.equal(rows[0].percentile,0);
  assert.equal(rows[19].percentile,1);
  assert.ok(rows[20].percentile < .2);
  assert.throws(()=>professionalSeasonRows(dataset([[1,"Bad",500,.2]]),"men"),/Insufficient/);
  assert.throws(()=>professionalSeasonRows({resultSets:[]},"men"),/Missing/);
  assert.equal(professionalSeasonRows(dataset([...leagueRows(),leagueRows()[0]]),"men").length,19);
  assert.equal(lastCompletedSeason("men",new Date("2026-03-01T00:00:00Z")),2025);
  assert.equal(lastCompletedSeason("men",new Date("2026-11-01T00:00:00Z")),2026);
  assert.equal(lastCompletedSeason("women",new Date("2026-09-01T00:00:00Z")),2025);
  assert.equal(lastCompletedSeason("women",new Date("2026-11-01T00:00:00Z")),2026);
});

test("traded players use the total row or combine distinct stints before applying minimum minutes", async () => {
  const {professionalSeasonRows} = await import("../pro-stats.js");
  const headers=["PLAYER_ID","PLAYER_NAME","MIN","PIE","TEAM_ID","TEAM_ABBREVIATION"];
  const data = leagueRows().map(row=>[...row,1,"AAA"]);
  data.push([21,"Traded Player",200,.1,1,"AAA"],[21,"Traded Player",300,.2,2,"BBB"]);
  data.push([22,"Total Player",300,.2,1,"AAA"],[22,"Total Player",300,.2,2,"BBB"],[22,"Total Player",600,.3,0,"TOT"]);
  const rows=professionalSeasonRows({resultSets:[{name:"LeagueDashPlayerStats",headers,rowSet:data}]},"men");
  const traded=rows.find(row=>row.id==="21");
  assert.equal(traded.minutes,500);
  assert.ok(Math.abs(traded.impact-.16)<1e-10);
  assert.equal(rows.find(row=>row.id==="22").impact,.3);
});

test("professional season API requests correct league and season and retries failures", async () => {
  const {handleProSeason} = await import("../pro-stats.js");
  const original = global.fetch, oldWarn = console.warn;
  const urls = [];
  try {
    console.warn = () => {};
    global.fetch = async url => {
      const request = new URL(url); urls.push(request);
      if (urls.length === 1) return new Response("",{status:503});
      return Response.json(dataset(leagueRows(250)));
    };
    const request = () => new Request("https://example.test/api/pro-season?gender=women&year=2022");
    assert.equal((await handleProSeason(request())).status,502);
    const result = await (await handleProSeason(request())).json();
    assert.equal(result.rows.length,20);
    assert.equal(urls[1].searchParams.get("LeagueID"),"10");
    assert.equal(urls[1].searchParams.get("Season"),"2022");
    assert.equal(urls[1].searchParams.get("MeasureType"),"Advanced");
    await handleProSeason(request());
    assert.equal(urls.length,2);
    assert.equal((await handleProSeason(new Request("https://example.test/api/pro-season?gender=men&year=1900"))).status,400);
  } finally { global.fetch = original; console.warn = oldWarn; }
});

test("older NBA seasons use era-relative box score impact when PIE is unavailable", async () => {
  const {professionalSeasonRows} = await import("../pro-stats.js");
  const headers=["PLAYER_ID","PLAYER_NAME","MIN","PTS","FGM","FGA","FTM","FTA","REB","AST","PF","OREB","DREB","STL","BLK","TOV"];
  const rowSet=Array.from({length:20},(_,i)=>[i+1,`Player ${i+1}`,1000,300+i*20,100,300,100,120,200,100,100,null,null,null,null,null]);
  const rows=professionalSeasonRows({resultSets:[{name:"LeagueDashPlayerStats",headers,rowSet}]},"men",1968);
  assert.equal(rows.length,20);
  assert.equal(rows[19].percentile,1);
  assert.throws(()=>professionalSeasonRows({resultSets:[{name:"LeagueDashPlayerStats",headers,rowSet}]},"men",1980),/Insufficient/);
});

test("peak averages best available seasons, excludes future classes and rejects ambiguous names", async () => {
  const calls = [];
  const seasons = {
    2023:[
      {id:"1",name:"Elite Latepick",percentile:.98},
      {id:"2",name:"Early Bust",percentile:.20},
      {id:"3",name:"Same Name",percentile:.8}
    ],
    2024:[
      {id:"1",name:"Elite Latepick",percentile:1},
      {id:"2",name:"Early Bust",percentile:.25},
      {id:"4",name:"Same Name",percentile:.9}
    ]
  };
  const context = vm.createContext({AbortSignal,console:{warn(){}},fetch:async url=>{
    const query=new URL(url,"https://example.test").searchParams;
    const year=Number(query.get("year")); calls.push(year);
    return Response.json({ok:true,gender:"men",year,rows:seasons[year]});
  }});
  const api=vm.runInContext(`${clientCode};({prepareProfessionalPotential,proPotentialStars})`,context);
  const players=[
    {fn:"Elite",ln:"Latepick",draftPick:55,proId:"1"},
    {fn:"Early",ln:"Bust",draftPick:1},
    {fn:"Same",ln:"Name",draftPick:8},
    {fn:"No",ln:"Stats",draftPick:9}
  ];
  await api.prepareProfessionalPotential(players,"0",2022,new Date("2024-11-01T00:00:00Z"));
  assert.equal(players[0].proPotential.stars,5);
  assert.equal(players[1].proPotential.stars,2.5);
  assert.equal(players[2].proPotential,undefined);
  assert.match(players[3].proPotentialStatus,/unavailable/);
  assert.equal(players[0].proPotential.partial,false);
  assert.deepEqual(calls.sort(),[2023,2024]);
  const future = [{fn:"Future",ln:"Player",projectedPick:1}];
  await api.prepareProfessionalPotential(future,"0",2025,new Date("2024-11-01T00:00:00Z"));
  assert.equal(calls.length,2);
  assert.equal(future[0].proPotential,undefined);
  assert.equal(api.proPotentialStars(.30),3);
  assert.equal(api.proPotentialStars(.75),4);
});

test("partial season failures remain visible and old classes never borrow late-career namesakes", async () => {
  let requests=0;
  const context=vm.createContext({AbortSignal,console:{warn(){}},fetch:async url=>{
    requests++;
    const year=Number(new URL(url,"https://example.test").searchParams.get("year"));
    if(year===2024)return new Response("",{status:503});
    return Response.json({ok:true,gender:"men",year,rows:year===2023?[{id:"1",name:"Sample Player",percentile:.9}]:[]});
  }});
  const prepare=vm.runInContext(`${clientCode};prepareProfessionalPotential`,context);
  const player={fn:"Sample",ln:"Player",draftPick:5};
  await prepare([player],"0",2022,new Date("2024-11-01T00:00:00Z"));
  assert.equal(player.proPotential.partial,true);
  assert.equal(player.proPotential.stars,4.5);
  const old={fn:"Sample",ln:"Player",draftPick:5};
  await prepare([old],"0",1970,new Date("2024-11-01T00:00:00Z"));
  assert.equal(requests,25);
  assert.match(old.proPotentialStatus,/unavailable/);
});

test("transformed class preparation obtains NBA season data through the worker", async () => {
  const {default:worker} = await import("../location-worker.js");
  const csv = fs.readFileSync(path.join(__dirname,"..","data/location-catalog.csv"),"utf8");
  const env = {ASSETS:{fetch:async r=>new URL(r.url).pathname.endsWith(".csv")?new Response(csv):new Response(html)}};
  const transformed = await (await worker.fetch(new Request("https://example.test/"),env)).text();
  const script=transformed.match(/<script>\nwindow\.__HOOPLAND_LOCATION_RECORDS[\s\S]*?<\/script>/)[0].slice(8,-9);
  const original=global.fetch;
  const players=[{fn:"Player",ln:"20",draftPick:50,proId:"20"}];
  try {
    global.fetch=async url=>{
      assert.equal(new URL(url).hostname,"stats.nba.com");
      return Response.json(dataset(leagueRows()));
    };
    const c=vm.createContext({
      window:{},URL,URLSearchParams,AbortSignal,console:{warn(){}},
      REAL_PLAYER_APPEARANCE_PROFILES:{},REAL_PLAYER_DESCRIPTIONS:{},
      normalizeAppearancePlayerName:name=>name.toLowerCase().replace(/[^a-z0-9]/g,""),
      parseLookDescription:()=>({}),
      document:{getElementById:id=>({value:id==="classType"?"draft":"2025"})},
      fetch:async url=>{
        const request=new URL(String(url),"https://example.test");
        if(request.pathname==="/api/pro-season")return worker.fetch(new Request(request),env);
        if(request.pathname==="/api/stats")return Response.json({ok:true,players:{}});
        if(request.pathname==="/api/hometown")return Response.json({headshots:[]});
        throw new Error("Unexpected request "+url);
      }
    });
    vm.runInContext(clientCode,c);
    c.prepareForTest=c.prepareProfessionalPotential;
    c.prepareProfessionalPotential=(people,gender,year)=>c.prepareForTest(people,gender,year,new Date("2026-11-01T00:00:00Z"));
    vm.runInContext(script,c);
    await c.window.__HOOPLAND_PREPARE_REAL_PLAYERS(players,"0");
    assert.equal(players[0].proPotential.stars,5);
    assert.equal(players[0].proPotential.metric,"PIE");
    assert.equal(players[0].proPotential.seasons[0],2026);
  } finally { global.fetch=original; }
});
