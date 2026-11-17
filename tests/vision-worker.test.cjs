const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("vision endpoint sends the visual reference sheet to Moondream and keys the cache by image", async () => {
  const { default: worker } = await import("../location-worker.js");
  const previousCaches = global.caches, previousCrypto = global.crypto;
  const calls = [], writes = [];
  try {
    global.crypto = require("node:crypto").webcrypto;
    global.caches = {default:{match:async request => {
      assert.match(request.url, /version=4/);
      assert.match(request.url, /image=[0-9a-f]{64}/);
      return null;
    }, put:async (...args) => {writes.push(args);}}};
    const env = {AI:{run:async (model,input) => {
      calls.push({model,input});
      return {answer:'{"skin tone":"D4", "hair colour":"K2", "hair style":"long braids"}'};
    }}};
    const pending = [];
    const request = new Request("https://example.test/api/describe?src="+encodeURIComponent("https://a.espncdn.com/test.png"),{
      method:"POST",headers:{"content-type":"image/jpeg"},body:Uint8Array.from([255,216,255,1,2,3])
    });
    const response = await worker.fetch(request,env,{waitUntil:promise=>pending.push(promise)});
    await Promise.all(pending);
    const body=await response.json();
    assert.equal(body.ok,true);
    assert.equal(body.text,"skin: d4; hair color: k2; hairstyle: long braids");
    assert.equal(calls.length,1);
    assert.equal(calls[0].model,"@cf/moondream/moondream3.1-9B-A2B");
    assert.equal(calls[0].input.image,"data:image/jpeg;base64,/9j/AQID");
    assert.equal(calls[0].input.task,"query");
    assert.match(calls[0].input.question,/swatch/);
    assert.match(calls[0].input.question,/unknown/);
    assert.equal(writes.length,1);
  } finally {
    global.caches = previousCaches;
    global.crypto = previousCrypto;
  }
});

test("vision requests reject unsafe sources, invalid images, and unusable results", async () => {
  const {default:worker}=await import("../location-worker.js");
  const previousCaches=global.caches,previousCrypto=global.crypto;
  try {
    global.crypto=require("node:crypto").webcrypto;
    global.caches={default:{match:async()=>null,put:async()=>{throw new Error("must not cache");}}};
    const env={AI:{run:async()=>({answer:"I cannot tell."})}};
    const req=(src,body=Uint8Array.from([255,216,255,0]))=>new Request("https://example.test/api/describe?src="+encodeURIComponent(src),{
      method:"POST",headers:{"content-type":"image/jpeg"},body
    });
    assert.equal((await worker.fetch(req("https://evil.example/x"),env,{})).status,403);
    assert.equal((await worker.fetch(req("https://a.espncdn.com/x",Uint8Array.from([1,2,3])),env,{})).status,400);
    const result=await worker.fetch(req("https://a.espncdn.com/x"),env,{waitUntil(){}});
    assert.equal((await result.json()).ok,false);
  } finally {global.caches=previousCaches;global.crypto=previousCrypto;}
});

test("reference photo redirects remain on trusted image hosts", async () => {
  const {default:worker}=await import("../location-worker.js");
  const original=global.fetch;
  try {
    global.fetch=async()=>new Response(null,{status:302,headers:{location:"https://evil.example/private"}});
    const response=await worker.fetch(new Request("https://example.test/api/headshot?src="+encodeURIComponent("https://commons.wikimedia.org/file")),{}, {});
    assert.equal(response.status,403);
  } finally {global.fetch=original;}
});

test("worker transforms retain location and player export fields", async () => {
  const { default: worker } = await import("../location-worker.js");
  const root = path.join(__dirname,"..");
  const html = fs.readFileSync(path.join(root,"index.html"),"utf8");
  const csv = fs.readFileSync(path.join(root,"data/location-catalog.csv"),"utf8");
  const env = {ASSETS:{fetch:async r=>new URL(r.url).pathname.endsWith(".csv")?new Response(csv):new Response(html)}};
  const transformed = await (await worker.fetch(new Request("https://example.test/"),env)).text();
  for (const text of ["__HOOPLAND_RESOLVE_LOCATION(player)","assignedLocation.loc","isReal: Boolean"])assert.ok(transformed.includes(text),text);
  assert.match(transformed,/STR:\s*\[0, 0\]/);
  assert.ok(!transformed.includes("__HOOPLAND_SAMPLE_HEADSHOT"));
});
