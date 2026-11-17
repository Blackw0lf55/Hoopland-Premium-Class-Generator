const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("vision endpoint sends the image in the documented field and invalidates old cache", async () => {
  const { default: worker } = await import("../location-worker.js");
  const previousFetch = global.fetch, previousCaches = global.caches;
  const calls = [], writes = [];
  try {
    global.fetch = async () => new Response(Uint8Array.from([1,2,3]), {headers:{"content-type":"image/png"}});
    global.caches = {default:{match:async request => {
      assert.match(request.url, /version=3/);
      return null;
    }, put:async (...args) => {writes.push(args);}}};
    const env = {AI:{run:async (model,input) => {
      calls.push({model,input});
      return {response:"skin: dark 4; hair color: black 2; hairstyle: unknown"};
    }}};
    const pending = [];
    const request = new Request("https://example.test/api/describe?src="+encodeURIComponent("https://a.espncdn.com/test.png"));
    const response = await worker.fetch(request,env,{waitUntil:promise=>pending.push(promise)});
    await Promise.all(pending);
    assert.equal((await response.json()).ok,true);
    assert.equal(calls.length,1);
    assert.equal(calls[0].model,"@cf/meta/llama-3.2-11b-vision-instruct");
    assert.equal(calls[0].input.image,"data:image/png;base64,AQID");
    assert.equal(typeof calls[0].input.messages[0].content,"string");
    assert.match(calls[0].input.messages[0].content,/unknown/);
    const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    const paletteCode = html.slice(html.indexOf("const APPEARANCE_PALETTES ="), html.indexOf("const MEN_HAIRS="));
    const palette = vm.runInNewContext(`${paletteCode}\nAPPEARANCE_PALETTES`);
    for (const group of palette) {
      assert.ok(calls[0].input.messages[0].content.includes(`${group.group} 1-${group.skins.length}: ${group.skins.join(", ")}`));
    }
    assert.equal(writes.length,1);
  } finally {
    global.fetch = previousFetch;
    global.caches = previousCaches;
  }
});

test("dark skin pixels are not rejected by the headshot sampler", async () => {
  const { default: worker } = await import("../location-worker.js");
  const root = path.join(__dirname,"..");
  const html = fs.readFileSync(path.join(root,"index.html"),"utf8");
  const csv = fs.readFileSync(path.join(root,"data/location-catalog.csv"),"utf8");
  const env = {ASSETS:{fetch:async r=>new URL(r.url).pathname.endsWith(".csv")?new Response(csv):new Response(html)}};
  const transformed = await (await worker.fetch(new Request("https://example.test/"),env)).text();
  for (const text of ["__HOOPLAND_RESOLVE_LOCATION(player)","assignedLocation.loc","isReal: Boolean"])assert.ok(transformed.includes(text),text);
  assert.match(transformed,/STR:\s*\[0, 0\]/);
  const match=transformed.match(/<script>\nwindow\.__HOOPLAND_LOCATION_RECORDS[\s\S]*?<\/script>/);
  assert.ok(match);
  const context=vm.createContext({window:{}});
  vm.runInContext(match[0].slice(8,-9),context);
  const data = new Uint8ClampedArray(100*100*4);
  for(let i=0;i<100*100;i++){data[i*4]=48;data[i*4+1]=29;data[i*4+2]=21;data[i*4+3]=255;}
  const sampled=context.window.__HOOPLAND_SAMPLE_HEADSHOT({width:100,height:100,data});
  assert.deepEqual(Array.from(sampled.skin),[48,29,21]);
});
