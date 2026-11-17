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
