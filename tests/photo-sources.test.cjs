const { test } = require("node:test");
const assert = require("node:assert/strict");

const claim = value => [{ mainsnak: { datavalue: { value } } }];

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
