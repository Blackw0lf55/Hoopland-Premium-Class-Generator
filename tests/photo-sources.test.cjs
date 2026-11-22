const { test } = require("node:test");
const assert = require("node:assert/strict");

const espnDraft = {
  displayName: "2026 Women's National Basketball Association Draft",
  picks: [
    { overall: 1, status: "SELECTION_MADE", athlete: {
      id:"4433790",displayName: "Azzi Fudd",
      headshot: { href: "https://a.espncdn.com/i/headshots/womens-college-basketball/players/full/4433790.png" }
    } },
    { overall: 2, status: "SELECTION_MADE", athlete: {
      displayName: "Frieda Bühner",
      headshot: { href: "https://a.espncdn.com/i/headshots/womens-college-basketball/players/full/1.png" }
    } },
    { overall: 3, status: "PENDING", athlete: {
      displayName: "Other Player", headshot: { href: "https://a.espncdn.com/other.png" }
    } }
  ]
};

test("ESPN draft identities are matched by year, name, and pick", async () => {
  const { espnDraftPlayers, attachEspnDraftPlayers } = await import("../class-sources.js");
  const photos = espnDraftPlayers(espnDraft, 2026);
  assert.equal(photos.length, 1);
  assert.deepEqual(espnDraftPlayers(espnDraft, 2025), []);
  const people = [
    {fn:"Azzi",ln:"Fudd",draftPick:1},
    {fn:"Frieda",ln:"Buhner",draftPick:2},
    {fn:"Different",ln:"Player",draftPick:1},
    {fn:"Azzi",ln:"Fudd",draftPick:7}
  ];
  const result = attachEspnDraftPlayers(people, photos);

  assert.equal(result[0].espnId,"4433790");

  assert.equal(result[2].headshots, undefined);
  assert.equal(result[3].headshots, undefined);
  assert.equal(result[3].espnId, undefined);
  const fam = attachEspnDraftPlayers([{fn:"Awa",ln:"Thiam",draftPick:3}],
    [{fn:"Awa",ln:"Fam",draftPick:3,headshot:"https://a.espncdn.com/fam.png"}]);

  assert.equal(attachEspnDraftPlayers([people[0]],[photos[0],photos[0]])[0].headshots, undefined);
  const unsafe = { ...espnDraft, picks:[{...espnDraft.picks[0], athlete:{...espnDraft.picks[0].athlete,headshot:{href:"https://evil.example/x"}}}] };
  assert.equal(espnDraftPlayers(unsafe,2026)[0].espnId,"4433790");
  const withoutPhoto = {...espnDraft, picks:[{...espnDraft.picks[0], athlete:{id:"4433790",displayName:"Azzi Fudd"}}]};
  const match = attachEspnDraftPlayers([people[0]],espnDraftPlayers(withoutPhoto,2026))[0];
  assert.equal(match.espnId,"4433790");
  assert.equal(match.headshots,undefined);
  const withMeasurements = {...espnDraft, picks:[{...espnDraft.picks[0],
    athlete:{...espnDraft.picks[0].athlete,displayHeight:"5' 11\"",displayWeight:"160 lbs"}}]};
  const dimensions = espnDraftPlayers(withMeasurements,2026);
  const updated = attachEspnDraftPlayers(people,dimensions);
  assert.equal(updated[0].height,71);
  assert.equal(updated[0].weight,160);
  assert.equal(updated[3].height,undefined);
  assert.equal(attachEspnDraftPlayers([{...people[0],height:72,weight:165}],dimensions)[0].weight,165);
});

test("completed ESPN draft selections are a fallback when other draft sources fail", async () => {
  const { handleClassData } = await import("../class-sources.js");
  const draft = {displayName:"2025 NBA Draft",picks:[
    {overall:2,status:"SELECTION_MADE",athlete:{id:"101",displayName:"Dylan Harper"}},
    {overall:1,status:"SELECTION_MADE",athlete:{id:"100",displayName:"Cooper Flagg",
      position:{abbreviation:"F"},displayHeight:"6' 9\"",displayWeight:"221 lbs"}}
  ]};
  const original = global.fetch;
  let data = draft;
  try {
    global.fetch = async url => {
      const request = new URL(url);
      if (request.hostname === "en.wikipedia.org") throw new Error("offline");
      if (request.hostname === "stats.nba.com") return new Response("",{status:503});
      if (request.hostname === "site.api.espn.com") return Response.json(data);
      throw new Error("Unexpected request " + url);
    };
    const request = () => handleClassData(new Request("https://example.test/api/class-data?type=draft&gender=men&year=2025"));
    let response = await request();
    let body = await response.json();
    assert.equal(response.status,200);
    assert.equal(body.source.fallback,"ESPN draft selections");
    assert.deepEqual(body.players.map(p=>p.fn),["Cooper","Dylan"]);
    assert.equal(body.players[0].position,"F");
    assert.equal(body.players[0].espnId,"100");
    assert.equal(body.players[0].height,81);
    assert.equal(body.players[0].weight,221);
    for (const invalid of [
      {...draft,displayName:"2024 NBA Draft"},
      {...draft,picks:[draft.picks[0],{...draft.picks[1],status:"PENDING"}]},
      {...draft,picks:[draft.picks[0],draft.picks[0]]},
      {...draft,picks:[draft.picks[0],{...draft.picks[1],athlete:{displayName:"Unknown"}}]}
    ]) {
      data = invalid;
      response = await request();
      assert.equal(response.status,502);
    }
  } finally { global.fetch = original; }
});

test("the curated 2026 WNBA route also attaches ESPN draft identities", async () => {
  const { default: worker } = await import("../location-worker.js");
  const { default: existingWorker } = await import("../worker.js");
  const oldFetch = global.fetch, oldWorkerFetch = existingWorker.fetch;
  try {
    existingWorker.fetch = async () => Response.json({
      players:[
        {fn:"Azzi",ln:"Fudd",draftPick:1,collegeTeamId:"901"},
        {fn:"Foreign",ln:"Prospect",draftPick:2,country:"France",birthYear:2007},
        {fn:"Domestic",ln:"Sophomore",draftPick:3,collegeTeamId:"901"}
      ], source:{name:"WNBA board"}
    });
    global.fetch = async url => {
      const request = new URL(url);
      if (request.pathname.endsWith("/teams/901/roster")) return Response.json({
        team:{id:"901"},season:{year:2026},
        athletes:[
          {id:"4433790",displayName:"Azzi Fudd",experience:{displayValue:"Senior"}},
          {id:"42",displayName:"Domestic Sophomore",experience:{displayValue:"Sophomore"}}
        ]
      });
      assert.equal(request.pathname,"/apis/site/v2/sports/basketball/wnba/draft");
      assert.equal(request.searchParams.get("season"),"2026");
      return Response.json(espnDraft);
    };
    const response = await worker.fetch(new Request("https://example.test/api/class-data?gender=women&type=draft&year=2026"),{});
    const body = await response.json();
    assert.equal(body.players[0].espnId,"4433790");
    assert.deepEqual(body.players.map(p=>p.ln),["Fudd","Prospect"]);
    assert.equal(body.source.seniorVerification.foreign,1);
    assert.equal(body.source.seniorVerification.notSenior,1);
    assert.equal(body.source.espnDraft.parsed,1);
    assert.equal(body.source.name,"WNBA board");
  } finally {
    global.fetch = oldFetch;
    existingWorker.fetch = oldWorkerFetch;
  }
});

test("2027 school-verified prospects remain available when draft history is unavailable", async () => {
  const {default:worker}=await import("../location-worker.js");
  const original=global.fetch;
  try {
    global.fetch=async()=>new Response("",{status:503});
    const response=await worker.fetch(new Request("https://example.test/api/class-data?type=draft&year=2027&gender=women"),{});
    const body=await response.json();
    assert.equal(response.status,200);
    assert.deepEqual(body.players.map(p=>[p.fn,p.ln,p.projectedPick]),[["JuJu","Watkins",1],["Hannah","Hidalgo",2]]);
    assert.match(body.warning,/prior draft results.*could not be verified/i);
  } finally { global.fetch=original; }
});

test("women's 2027 projections prioritize Watkins and Hidalgo and reject non-senior US players", async () => {
  const { handleClassData } = await import("../class-sources.js");
  const recruits = names => `<table><tr><th>Rank</th><th>Player</th></tr>${names.map((name,i)=>
    `<tr><td>${i+1}</td><td><a href="/recruiting/player/${i+1}">${name}</a></td></tr>`).join("")}</table>`;
  const original = global.fetch;
  try {
    global.fetch = async input => {
      const url=new URL(input);
      if (url.hostname==="www.espn.com") {
        const year=Number(url.pathname.split("/").pop());
        const names=year===2023?["Judea Watkins","Hannah Hidalgo","Other Senior","Unknown Player"]
          :year===2025?["Jazzy Davidson"]:[];
        return names.length?new Response(recruits(names)):new Response("",{status:404});
      }
      if (url.hostname==="en.wikipedia.org") return new Response("",{status:404});
      if (url.hostname==="stats.nba.com") {
        const season=Number(url.searchParams.get("Season"));
        return Response.json({resultSets:[{headers:["PLAYER_NAME","OVERALL_PICK","ROUND_NUMBER","ROUND_PICK"],
          rowSet:season===2027?[]:[["Already Drafted",1,1,1]]}]});
      }
      if (url.hostname==="site.api.espn.com") return Response.json({});
      throw new Error("Unexpected URL: "+url);
    };
    const request=new Request("https://example.test/api/class-data?type=draft&year=2027&gender=women");
    const response=await handleClassData(request,{verifySenior:async p=>
      p.ln==="Senior"?true:p.ln==="Davidson"?false:null});
    const body=await response.json();
    assert.equal(response.status,200);
    assert.deepEqual(body.players.map(p=>[p.fn,p.ln,p.projectedPick]),[
      ["JuJu","Watkins",1],["Hannah","Hidalgo",2],["Other","Senior",3]
    ]);
    assert.equal(body.source.seniorVerification.notSenior,1);
    assert.match(body.warning,/senior status could not be verified/);
  } finally { global.fetch=original; }
});

test("international prospects may be non-seniors, but US and unknown countries require verification", async () => {
  const {filterWomenDraftSeniors}=await import("../class-sources.js");
  const players=[
    {fn:"A",ln:"Senior",country:"United States"},
    {fn:"B",ln:"Sophomore",country:"US"},
    {fn:"C",ln:"Foreign",country:"France"},
    {fn:"D",ln:"Unknown",country:""},
    {fn:"E",ln:"Territory",country:"Puerto Rico"}
  ];
  const result=await filterWomenDraftSeniors(players,2028,async p=>
    p.ln==="Senior"?true:p.ln==="Sophomore"?false:null);
  assert.deepEqual(result.players.map(p=>p.ln),["Senior","Foreign"]);
  assert.equal(result.foreign,1);
  assert.equal(result.notSenior,1);
  assert.equal(result.unverified,2);
});

test("senior verification requires an exact player and roster season", async () => {
  const {verifyWomenDraftSenior}=await import("../location-worker.js");
  const original=global.fetch;
  try {
    global.fetch=async input=>{
      const url=new URL(input), id=url.pathname.match(/\/teams\/(\d+)\/roster$/)?.[1];
      assert.equal(url.searchParams.get("season"),"2027");
      if (id==="910") return Response.json({team:{id},season:{year:2027},athletes:[
        {id:"1",displayName:"Senior Player",experience:{displayValue:"Senior"}},
        {id:"2",displayName:"Jazzy Davidson",experience:{displayValue:"Sophomore"}}
      ]});
      if (id==="911") return Response.json({team:{id},season:{year:2026},athletes:[
        {id:"3",displayName:"Wrong Season",experience:{displayValue:"Senior"}}
      ]});
      throw new Error("Unexpected roster "+id);
    };
    assert.equal(await verifyWomenDraftSenior({fn:"Senior",ln:"Player",collegeTeamId:"910"},2027),true);
    assert.equal(await verifyWomenDraftSenior({fn:"Jazzy",ln:"Davidson",collegeTeamId:"910"},2027),false);
    assert.equal(await verifyWomenDraftSenior({fn:"Wrong",ln:"Season",collegeTeamId:"911"},2027),null);
    assert.equal(await verifyWomenDraftSenior({fn:"Missing",ln:"Player",collegeTeamId:"910"},2027),null);
  } finally { global.fetch=original; }
});

test("freshman ranking commitments retain college IDs or explicit college names", async () => {
  const { parseEspnRecruits, handleClassData } = await import("../class-sources.js");
  const html = `<table><tr><th>Rank</th><th>Player</th><th>High School</th><th>College</th></tr>
    <tr><td>1</td><td><a href="/recruiting/player/1">First Recruit</a></td><td>Central High</td><td><a href="/recruiting/school/_/id/30">USC</a></td></tr>
    <tr><td>2</td><td><a href="/recruiting/player/2">Second Recruit</a></td><td>East High</td><td>Example College</td></tr>
    <tr><td>3</td><td><a href="/recruiting/player/3">Third Recruit</a></td><td>West High</td><td><a href="/recruiting/school/_/id/30">USC</a><a href="/recruiting/school/_/id/99">Other</a></td></tr></table>`;
  const players = parseEspnRecruits(html);
  assert.equal(players[0].collegeTeamId, "30");
  assert.equal(players[0].committedCollege, "USC");
  assert.equal(players[1].committedCollege, "Example College");
  assert.equal(players[1].collegeTeamId, undefined);
  assert.equal(players[2].committedCollege, "");
  assert.equal(players[2].collegeTeamId, undefined);
  const noCollege = parseEspnRecruits(`<table><tr><th>Rank</th><th>Player</th><th>School</th></tr>
    <tr><td>1</td><td><a href="/recruiting/player/1">First Recruit</a></td><td>Central High</td></tr></table>`);
  assert.equal(noCollege[0].committedCollege, "");

  const original = global.fetch;
  try {
    global.fetch = async () => new Response(html);
    for (const gender of ["men", "women"]) {
      const response = await handleClassData(new Request(`https://example.test/api/class-data?type=freshman&year=2025&gender=${gender}`));
      const result = await response.json();
      assert.equal(result.players[0].recruitYear, 2025);
      assert.equal(result.players[0].collegeTeamId, "30");
    }
  } finally { global.fetch = original; }
});

test("recruit names exclude video and scouting links without guessing ambiguous names", async () => {
  const { parseEspnRecruits } = await import("../class-sources.js");
  const html = `<table><tr><th>Rank</th><th>Player</th></tr>
    <tr><td>1</td><td><a href="/recruiting/player/_/id/1"><b>Tyran Stokes</b></a>
      <a href="/recruiting/player/_/id/1/video">Video</a> | <a href="/recruiting/player/_/id/1/scouting">Scouts Report</a></td></tr>
    <tr><td>2</td><td><a href='/player/2'>Jean de la Cruz</a> Video | Scouts Report</td></tr>
    <tr><td>3</td><td><a href="/player/3">Avery Jones <span>Video | Scouts Report</span></a></td></tr>
    <tr><td>4</td><td><a href="/player/4">First Person</a><a href="/player/5">Second Person</a></td></tr>
    <tr><td>5</td><td><a href="/player/6">Scouts Report</a></td></tr></table>`;
  const players = parseEspnRecruits(html);
  assert.deepEqual(players.map(({fn,ln})=>[fn,ln]),[
    ["Tyran","Stokes"],["Jean","de la Cruz"],["Avery","Jones"]
  ]);
  assert.deepEqual(players.map(player=>player.rank),[1,2,3]);
});

test("future draft projection uses recruit identities before excluding already-drafted players", async () => {
  const { handleClassData } = await import("../class-sources.js");
  const html = `<table><tr><th>Rank</th><th>Player</th></tr>
    <tr><td>1</td><td><a href="/recruiting/player/1">Tyran Stokes</a> Video | Scouts Report</td></tr>
    <tr><td>2</td><td><a href="/recruiting/player/2">Already Drafted</a> Video | Scouts Report</td></tr>
    <tr><td>3</td><td><a href="/recruiting/player/3">AJ Roster</a></td></tr></table>`;
  const original = global.fetch;
  try {
    global.fetch = async input => {
      const url = new URL(input);
      if (url.hostname === "www.espn.com") {
        return url.pathname.endsWith("/2026") ? new Response(html) : new Response("",{status:404});
      }
      if (url.hostname === "en.wikipedia.org") return new Response("",{status:404});
      if (url.hostname === "stats.nba.com") {
        if (url.pathname.endsWith("/commonallplayers")) return Response.json({resultSets:[
          {headers:["DISPLAY_FIRST_LAST"],rowSet:[["A.J. Roster"]]}]});
        const name = url.searchParams.get("Season") === "2025" ? "Already Drafted" : "Other Player";
        return Response.json({resultSets:[{headers:["PLAYER_NAME","OVERALL_PICK","ROUND_NUMBER","ROUND_PICK"],
          rowSet:url.searchParams.get("Season") === "2027" ? [] : [[name,1,1,1]]}]});
      }
      if (url.hostname === "site.api.espn.com") return Response.json({});
      throw new Error("Unexpected URL: " + url);
    };
    const response = await handleClassData(new Request("https://example.test/api/class-data?type=draft&year=2027&gender=men"));
    const result = await response.json();
    assert.equal(response.status,200);
    assert.equal(result.source.projected,true);
    assert.deepEqual(result.players.map(({fn,ln,projectedPick})=>[fn,ln,projectedPick]),[["Tyran","Stokes",1]]);
  } finally { global.fetch = original; }
});

test("future draft checks ESPN history without headshots and reports unavailable sources", async () => {
  const { handleClassData } = await import("../class-sources.js");
  const html = `<table><tr><th>Rank</th><th>Player</th></tr>
    <tr><td>1</td><td><a href="/player/1">Current Prospect</a></td></tr>
    <tr><td>2</td><td><a href="/player/2">Jalen Drafted</a></td></tr></table>`;
  const original = global.fetch;
  let missingYear = false;
  try {
    global.fetch = async input => {
      const url = new URL(input);
      if (url.hostname === "www.espn.com") return url.pathname.endsWith("/2026")
        ? new Response(html) : new Response("",{status:404});
      if (url.hostname === "en.wikipedia.org" || url.hostname === "stats.nba.com") return new Response("",{status:503});
      if (url.hostname === "site.api.espn.com") {
        const year = Number(url.searchParams.get("season"));
        if (year === 2027 || (missingYear && year === 2025)) return new Response("",{status:503});
        return Response.json({season:{year},picks:[{status:"SELECTION_MADE",athlete:{
          displayName:year === 2026 ? "Jalen Drafted" : "Other Player"
        }}]});
      }
      throw new Error("Unexpected URL: " + url);
    };
    const request = () => new Request("https://example.test/api/class-data?type=draft&year=2027&gender=men");
    const response = await handleClassData(request());
    const body = await response.json();
    assert.equal(response.status,200);
    assert.deepEqual(body.players.map(({fn,ln})=>[fn,ln]),[["Current","Prospect"]]);
    assert.match(body.warning,/roster could not be verified/i);
    missingYear = true;
    const failed = await handleClassData(request());
    const failure = await failed.json();
    assert.equal(failed.status,502);
    assert.match(failure.error,/2025/);
    assert.deepEqual(failure.diagnostics.missingDraftYears,[2025]);
  } finally { global.fetch = original; }
});

test("college roster identities require correct gender, team, season and exact unique name", async () => {
  const { collegeRosterPlayer } = await import("../location-worker.js");
  const original = global.fetch;
  const image = (league, id) => `https://a.espncdn.com/i/headshots/${league}/players/full/${id}.png`;
  const athlete = (league, name = "First Recruit", id = "17") => ({id, displayName:name, headshot:{href:image(league,id)}});
  const responses = {
    101:{team:{id:"101"},season:{year:2026},athletes:[athlete("womens-college-basketball")]},
    102:{team:{id:"102"},season:{year:2026},athletes:[athlete("mens-college-basketball")]},
    103:{team:{id:"999"},season:{year:2026},athletes:[athlete("mens-college-basketball")]},
    104:{team:{id:"104"},season:{year:2035},athletes:[athlete("mens-college-basketball")]},
    105:{team:{id:"105"},season:{year:2026},athletes:[athlete("mens-college-basketball","First Recruit Jr")]},
    106:{team:{id:"106"},season:{year:2026},athletes:[athlete("mens-college-basketball"),athlete("mens-college-basketball","First Recruit","18")]},
    107:{team:{id:"107"},season:{year:2026},athletes:[{id:"17",displayName:"First Recruit"}]},
    108:{team:{id:"108"},season:{year:2026},athletes:[{id:"17",displayName:"First Recruit",headshot:{href:image("mens-college-basketball","18")}}]},
    109:{team:{id:"109"},season:{year:2026},athletes:[{id:"17",displayName:"First Recruit",headshot:{href:"https://evil.example/17.png"}}]},
    110:{team:{id:"110"},athletes:[athlete("mens-college-basketball")]},
    111:{team:{id:"111"},season:{year:2024},athletes:[athlete("mens-college-basketball")]},
  };
  const calls = [];
  try {
    global.fetch = async url => {
      const path = new URL(url).pathname;
      calls.push(path);
      const id = path.match(/\/teams\/(\d+)\/roster$/)?.[1];
      assert.ok(id && responses[id], path);
      return Response.json(responses[id]);
    };
    assert.equal((await collegeRosterPlayer("First Recruit","women","101",2025)).id,"17");
    assert.equal((await collegeRosterPlayer("First Recruit","men","102",2025)).id,"17");
    for (const id of ["103","104","105","106","110","111"]) {
      assert.equal(await collegeRosterPlayer("First Recruit","men",id,2025),null,id);
    }
    assert.equal(await collegeRosterPlayer("First Recruit","men","102",2010),null);
    assert.equal((await collegeRosterPlayer("First Recruit","men","102",2025)).id,"17");
    assert.equal(calls.filter(path => path.includes("/102/")).length,1);
    assert.ok(calls.some(path => path.includes("womens-college-basketball")));
    assert.ok(calls.some(path => path.includes("mens-college-basketball")));
  } finally { global.fetch = original; }
});

test("draft roster identities require the correct historical season and college", async () => {
  const { collegeRosterPlayer } = await import("../location-worker.js");
  const original = global.fetch;
  const calls = [];
  const image = id => `https://a.espncdn.com/i/headshots/womens-college-basketball/players/full/${id}.png`;
  try {
    global.fetch = async url => {
      const request = new URL(url);
      calls.push(request);
      const id = request.pathname.match(/\/teams\/(\d+)\/roster$/)?.[1];
      assert.ok(id);
      const name = id === "39101" ? "Laura Ziegler" : "Laila Phelia";
      const athleteId = id === "39101" ? "60001" : "60002";
      const year = Number(request.searchParams.get("season"));
      return Response.json({team:{id},season:{year:year === 2025 ? 2024 : year},athletes:[
        {id:athleteId,displayName:name,headshot:{href:image(athleteId)}}
      ]});
    };
    assert.equal((await collegeRosterPlayer("Laura Ziegler","women","39101",0,"Louisville Cardinals",2026)).id,"60001");
    assert.equal((await collegeRosterPlayer("Laila Phelia","women","39102",0,"Syracuse Orange",2026)).id,"60002");
    assert.equal(await collegeRosterPlayer("Laura Ziegler","women","39102",0,"Syracuse Orange",2026),null);
    assert.equal(await collegeRosterPlayer("Laura Ziegler","women","39101",0,"Louisville Cardinals",2025),null);
    assert.ok(calls.some(url => url.searchParams.get("season") === "2026"));
  } finally { global.fetch = original; }
});

test("the McDonald's fallback distinguishes college commitments from high schools", async () => {
  const { handleClassData } = await import("../class-sources.js");
  const original = global.fetch;
  const html = `<table><tr><th>Player</th><th>High School</th><th>College</th></tr>
    <tr><td>First Recruit</td><td>Central High</td><td>Unique University</td></tr></table>`;
  try {
    global.fetch = async url => new URL(url).hostname === "en.wikipedia.org"
      ? Response.json({parse:{text:html}}) : new Response("",{status:503});
    for (const gender of ["men","women"]) {
      const response = await handleClassData(new Request(`https://example.test/api/class-data?type=freshman&year=2025&gender=${gender}`));
      const { players } = await response.json();
      assert.equal(players[0].school,"Central High");
      assert.equal(players[0].committedCollege,"Unique University");
      assert.equal(players[0].recruitYear,2025);
    }
  } finally { global.fetch = original; }
});

test("school names must identify one ESPN team, and failed roster requests can be retried", async () => {
  const { collegeRosterPlayer } = await import("../location-worker.js");
  const original = global.fetch;
  let rosterCalls = 0;
  try {
    global.fetch = async url => {
      const path = new URL(url).pathname;
      if (path.endsWith("/teams")) return Response.json({sports:[{leagues:[{teams:[
        {team:{id:"201",location:"Unique University",displayName:"Unique University Tigers"}},
        {team:{id:"202",location:"Shared College"}},
        {team:{id:"203",location:"Shared College"}}
      ]}]}]});
      assert.match(path,/\/201\/roster$/);
      rosterCalls++;
      if (rosterCalls === 1) return new Response("",{status:503});
      return Response.json({team:{id:"201"},season:{year:2026},athletes:[{
        id:"42",displayName:"First Recruit",
        headshot:{href:"https://a.espncdn.com/i/headshots/womens-college-basketball/players/full/42.png"}
      }]});
    };
    assert.equal(await collegeRosterPlayer("First Recruit","women","",2025,"Shared College"),null);
    await assert.rejects(collegeRosterPlayer("First Recruit","women","",2025,"Unique University"),/503/);
    assert.equal((await collegeRosterPlayer("First Recruit","women","",2025,"Unique University")).id,"42");
    assert.equal(rosterCalls,2);
  } finally { global.fetch = original; }
});
