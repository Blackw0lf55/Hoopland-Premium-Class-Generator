const { test } = require("node:test");
const assert = require("node:assert/strict");

const claim = value => [{ mainsnak: { datavalue: { value } } }];

const espnDraft = {
  displayName: "2026 Women's National Basketball Association Draft",
  picks: [
    { overall: 1, status: "SELECTION_MADE", athlete: {
      displayName: "Azzi Fudd",
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

test("ESPN draft portraits are matched by year, name, and pick", async () => {
  const { espnDraftPhotos, attachEspnDraftPhotos } = await import("../class-sources.js");
  const photos = espnDraftPhotos(espnDraft, 2026);
  assert.equal(photos.length, 2);
  assert.deepEqual(espnDraftPhotos(espnDraft, 2025), []);
  const people = [
    {fn:"Azzi",ln:"Fudd",draftPick:1},
    {fn:"Frieda",ln:"Buhner",draftPick:2},
    {fn:"Different",ln:"Player",draftPick:1},
    {fn:"Azzi",ln:"Fudd",draftPick:7}
  ];
  const result = attachEspnDraftPhotos(people, photos);
  assert.match(result[0].headshots[0], /4433790/);
  assert.match(result[1].headshots[0], /\/1\.png/);
  assert.equal(result[2].headshots, undefined);
  assert.equal(result[3].headshots, undefined);
  const fam = attachEspnDraftPhotos([{fn:"Awa",ln:"Thiam",draftPick:3}],
    [{fn:"Awa",ln:"Fam",draftPick:3,headshot:"https://a.espncdn.com/fam.png"}]);
  assert.equal(fam[0].headshots[0], "https://a.espncdn.com/fam.png");
  assert.equal(attachEspnDraftPhotos([people[0]],[photos[0],photos[0]])[0].headshots, undefined);
  const unsafe = { ...espnDraft, picks:[{...espnDraft.picks[0], athlete:{...espnDraft.picks[0].athlete,headshot:{href:"https://evil.example/x"}}}] };
  assert.deepEqual(espnDraftPhotos(unsafe,2026), []);
});

test("the curated 2026 WNBA route also attaches ESPN draft photos", async () => {
  const { default: worker } = await import("../location-worker.js");
  const { default: existingWorker } = await import("../worker.js");
  const oldFetch = global.fetch, oldWorkerFetch = existingWorker.fetch;
  try {
    existingWorker.fetch = async () => Response.json({
      players:[{fn:"Azzi",ln:"Fudd",draftPick:1}], source:{name:"WNBA board"}
    });
    global.fetch = async url => {
      const request = new URL(url);
      assert.equal(request.pathname,"/apis/site/v2/sports/basketball/wnba/draft");
      assert.equal(request.searchParams.get("season"),"2026");
      return Response.json(espnDraft);
    };
    const response = await worker.fetch(new Request("https://example.test/api/class-data?gender=women&type=draft&year=2026"),{});
    const body = await response.json();
    assert.match(body.players[0].headshots[0],/4433790/);
    assert.equal(body.source.espnPhotos.parsed,2);
    assert.equal(body.source.name,"WNBA board");
  } finally {
    global.fetch = oldFetch;
    existingWorker.fetch = oldWorkerFetch;
  }
});

test("Wikimedia photos require an unambiguous exact player and matching filenames", async () => {
  const { wikidataPhotos } = await import("../enrich.js");
  const original = global.fetch;
  const calls = [];
  try {
    global.fetch = async url => {
      const request = new URL(url);
      calls.push(request);
      if (request.searchParams.get("action") === "wbsearchentities") {
        return Response.json({search:[{id:"Q1",label:"Frieda Bühner",description:"German basketball player"}]});
      }
      if (request.searchParams.get("action") === "wbgetentities") {
        return Response.json({entities:{Q1:{claims:{
          P18:claim("Frieda Bühner 1.jpg"),
          P373:claim("Frieda Bühner")
        }}}});
      }
      assert.equal(request.hostname, "commons.wikimedia.org");
      assert.equal(request.searchParams.get("gcmtitle"), "Category:Frieda Bühner");
      const page = (title, url) => ({title, imageinfo:[{thumburl:url}]});
      return Response.json({query:{pages:{
        1:page("File:Frieda Bühner 1.jpg","https://upload.wikimedia.org/one.jpg"),
        2:page("File:Frieda Bühner 2.jpg","https://upload.wikimedia.org/two.jpg"),
        3:page("File:Another player.jpg","https://upload.wikimedia.org/other.jpg"),
        4:page("File:Frieda Bühner 3.jpg","https://untrusted.example/three.jpg"),
        5:page("File:Frieda Bühner 4.jpg","https://upload.wikimedia.org/four.jpg")
      }}});
    };
    const photos = await wikidataPhotos("Frieda Buhner");
    assert.equal(photos.length, 3);
    assert.match(photos[0], /Special:FilePath/);
    assert.deepEqual(photos.slice(1),["https://upload.wikimedia.org/two.jpg","https://upload.wikimedia.org/four.jpg"]);
    assert.equal(calls.length, 3);
  } finally {
    global.fetch = original;
  }
});

test("ambiguous or inexact Wikimedia names never supply a photo", async () => {
  const { wikidataPhotos } = await import("../enrich.js");
  const original = global.fetch;
  try {
    let response = {search:[
      {id:"Q1",label:"Frieda Bühner",description:"basketball player"},
      {id:"Q2",label:"Frieda Buhner",description:"basketball player"}
    ]};
    global.fetch = async () => Response.json(response);
    assert.deepEqual(await wikidataPhotos("Frieda Buhner"), []);
    response = {search:[{id:"Q1",label:"Frieda Buhner Jr",description:"basketball player"}]};
    assert.deepEqual(await wikidataPhotos("Frieda Buhner"), []);
  } finally {
    global.fetch = original;
  }
});

test("a Commons category error does not discard the Wikidata portrait", async () => {
  const { wikidataPhotos } = await import("../enrich.js");
  const original = global.fetch, oldWarn = console.warn;
  try {
    console.warn = () => {};
    global.fetch = async url => {
      const request = new URL(url);
      if (request.searchParams.get("action") === "wbsearchentities") {
        return Response.json({search:[{id:"Q1",label:"Frieda Bühner",description:"basketball player"}]});
      }
      if (request.searchParams.get("action") === "wbgetentities") {
        return Response.json({entities:{Q1:{claims:{P18:claim("Frieda Bühner.jpg"),P373:claim("Frieda Bühner")}}}});
      }
      return new Response("unavailable",{status:503});
    };
    const photos = await wikidataPhotos("Frieda Buhner");
    assert.equal(photos.length,1);
    assert.match(photos[0],/Special:FilePath/);
  } finally {
    global.fetch = original;
    console.warn = oldWarn;
  }
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

test("college roster portraits require correct gender, team, season, exact unique name and athlete URL", async () => {
  const { collegeRosterHeadshot } = await import("../location-worker.js");
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
    assert.equal(await collegeRosterHeadshot("First Recruit","women","101",2025),image("womens-college-basketball","17"));
    assert.equal(await collegeRosterHeadshot("First Recruit","men","102",2025),image("mens-college-basketball","17"));
    for (const id of ["103","104","105","106","107","108","109","110","111"]) {
      assert.equal(await collegeRosterHeadshot("First Recruit","men",id,2025),"",id);
    }
    assert.equal(await collegeRosterHeadshot("First Recruit","men","102",2010),"");
    assert.equal(await collegeRosterHeadshot("First Recruit","men","102",2025),image("mens-college-basketball","17"));
    assert.equal(calls.filter(path => path.includes("/102/")).length,1);
    assert.ok(calls.some(path => path.includes("womens-college-basketball")));
    assert.ok(calls.some(path => path.includes("mens-college-basketball")));
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
  const { collegeRosterHeadshot } = await import("../location-worker.js");
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
    assert.equal(await collegeRosterHeadshot("First Recruit","women","",2025,"Shared College"),"");
    await assert.rejects(collegeRosterHeadshot("First Recruit","women","",2025,"Unique University"),/503/);
    assert.match(await collegeRosterHeadshot("First Recruit","women","",2025,"Unique University"),/42\.png$/);
    assert.equal(rosterCalls,2);
  } finally { global.fetch = original; }
});
