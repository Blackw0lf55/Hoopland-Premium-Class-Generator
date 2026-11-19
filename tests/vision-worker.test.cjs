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
      assert.match(request.url, /version=6/);
      assert.match(request.url, /image=[0-9a-f]{64}/);
      return null;
    }, put:async (...args) => {writes.push(args);}}};
    const env = {AI:{run:async (model,input) => {
      calls.push({model,input});
      return {answer:'{"skin tone":"D4 (dark brown)", "hair colour":"K2 (black)", "hair style":"long braids"}'};
    }}};
    const pending = [];
    const request = new Request("https://example.test/api/describe?gender=women&src="+encodeURIComponent("https://a.espncdn.com/test.png"),{
      method:"POST",headers:{"content-type":"image/jpeg"},body:Uint8Array.from([255,216,255,1,2,3])
    });
    const response = await worker.fetch(request,env,{waitUntil:promise=>pending.push(promise)});
    await Promise.all(pending);
    const body=await response.json();
    assert.equal(body.ok,true);
    assert.equal(body.text,"skin: d4 (dark brown); hair color: k2 (black); hairstyle: long braids");
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

test("vision retries missing features independently and asks about facial hair only for men", async () => {
  const {default:worker}=await import("../location-worker.js");
  const previousCaches=global.caches,previousCrypto=global.crypto;
  try {
    global.crypto=require("node:crypto").webcrypto;
    global.caches={default:{match:async()=>null,put:async()=>{}}};
    for (const gender of ["men","women"]) {
      const questions=[];
      const env={AI:{run:async (_,input)=>{
        questions.push(input.question);
        if (input.question.includes("Output only")) return {answer:"skin: unknown; hair color: K2; hairstyle: unknown; facial hair: unknown"};
        if (input.question.includes("skin swatches")) return {answer:"D4"};
        if (input.question.includes("hairstyle")) return {answer:"short curly hair with a fade"};
        if (input.question.includes("facial hair")) return {answer:"short beard"};
        throw new Error("Unexpected question");
      }}};
      const request=new Request("https://example.test/api/describe?gender="+gender+"&src="+encodeURIComponent("https://a.espncdn.com/a.png"),{
        method:"POST",headers:{"content-type":"image/jpeg"},body:Uint8Array.from([255,216,255,1])
      });
      const body=await (await worker.fetch(request,env,{waitUntil(){}})).json();
      assert.equal(body.ok,true);
      assert.match(body.text,/skin: D4/);
      assert.match(body.text,/hair color: k2/);
      assert.match(body.text,/hairstyle: short curly hair with a fade/);
      assert.equal(questions.some(q=>q.startsWith("Describe visible facial hair")),gender==="men");
      assert.equal(body.text.includes("facial hair: short beard"),gender==="men");
    }
  } finally {global.caches=previousCaches;global.crypto=previousCrypto;}
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
  assert.match(transformed,/STR:\s*\[\s*player\.physical\.STR,\s*player\.physical\.STR/);
  assert.ok(!transformed.includes("__HOOPLAND_SAMPLE_HEADSHOT"));
  const code=transformed.slice(transformed.indexOf("function makeHoopLandPlayer("),transformed.indexOf("function downloadHoopLand()"));
  const exportPlayer=vm.runInNewContext(code+"\nmakeHoopLandPlayer",{
    window:{__HOOPLAND_RESOLVE_LOCATION:()=>({home:"",loc:{x:1,y:2}})},
    randomInteger:()=>1,document:{getElementById:()=>({value:"0"})},makeEmptyStatLine:()=>({})
  });
  const player={
    fn:"Test",ln:"Player",ctry:"US",age:20,ht:78,wt:200,year:1,pos:4,arc:"GOAT",pot:10,regressionAge:32,
    appearance:{skinC:"AD795C",eyeC:"090502",browC:"202020",hair:"0001",hairC:"202020",fHair:"0000",fHairC:"202020",accessories:[]},
    attributes:{DRB:[12,20]},physical:{STR:10,SPD:10,STA:10},tendencies:{}
  };
  const exported=exportPlayer(player,0);
  assert.equal(exported.arc,"GOAT");
  assert.equal(exported.pot,10);
  assert.equal(exported.attributes.DRB[1],20);
  assert.deepEqual(Array.from(exported.attributes.STR),[10,10]);
  assert.deepEqual(Array.from(exported.attributes.SPD),[10,10]);
  assert.deepEqual(Array.from(exported.attributes.STM),[10,10]);
});
