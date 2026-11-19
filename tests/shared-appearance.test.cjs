const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("community looks persist per player, class and gender and reject cross-origin and invalid writes", async () => {
  const {default:worker,SharedAppearance} = await import("../location-worker.js");
  const objects = new Map();
  const env = {APPEARANCES:{
    idFromName:name=>name,
    get:id=>{
      if(!objects.has(id)){
        const values=new Map();
        const storage={get:async k=>values.get(k),put:async(k,v)=>values.set(k,v)};
        storage.transaction=fn=>fn(storage);
        objects.set(id,new SharedAppearance({storage}));
      }
      return {fetch:(url,init)=>objects.get(id).fetch(new Request(url,init))};
    }
  }};
  const url = "https://example.test/api/shared-appearance?"+new URLSearchParams({name:"AJ Dynasty",gender:"men",type:"draft",year:"2026"});
  const look = {skinC:"835444",hairC:"202020",hair:"0001",fHair:"0016"};
  const put = (target,body,origin="https://example.test") => worker.fetch(new Request(target,{
    method:"PUT",headers:{"content-type":"application/json",origin},body:JSON.stringify(body)
  }),env);
  assert.equal((await put(url,look,"https://other.example")).status,403);
  assert.equal((await put(url,{...look,hair:"9999"})).status,400);
  assert.equal((await put(url,{...look,extra:"x"})).status,400);
  assert.equal((await put(url,look)).status,200);
  assert.deepEqual((await (await worker.fetch(new Request(url),env)).json()).appearances,[look]);
  for (const changed of [url.replace("2026","2027"),url.replace("men","women"),url.replace("draft","freshman")]) {
    assert.deepEqual((await (await worker.fetch(new Request(changed),env)).json()).appearances,[]);
  }
  assert.equal((await put(url.replace("men","women"),look)).status,400);
  const next={...look,hair:"0008"};
  assert.equal((await put(url,next)).status,200);
  for(let i=0;i<5;i++) assert.equal((await put(url,{hair:"000"+i})).status,200);
  assert.deepEqual((await (await worker.fetch(new Request(url),env)).json()).appearances,
    Array.from({length:5},(_,i)=>({hair:"000"+i})));
  assert.equal((await worker.fetch(new Request(url),{})).status,503);
});

test("saved appearance overrides the generated look and updates matching skin segments", () => {
  const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  const palettes=html.slice(html.indexOf("const APPEARANCE_PALETTES ="),html.indexOf("const MEN_HAIRS="));
  const helpers=html.slice(html.indexOf("function validSharedAppearance("),html.indexOf("function appearanceSourceFor("));
  const {apply,valid,combine}=vm.runInNewContext(`${palettes}
    function colorLum(h){return .299*parseInt(h.slice(0,2),16)+.587*parseInt(h.slice(2,4),16)+.114*parseInt(h.slice(4,6),16)}
    function appearanceHairPalette(g){return [...new Set(APPEARANCE_PALETTES.flatMap(p=>p.hair[g]||[]))]}
    function getHairReference(i){return i>=0&&i<=170?{}:null}
    function getFacialHairReference(i){return i>=0&&i<=31?{}:null}
    ${helpers}
    ({apply:applySharedAppearance,valid:validSharedAppearance,combine:combineSharedAppearances})`);
  const base={skinC:"F4D2C3",hairC:"202020",hair:"0001",fHair:"0000",accessories:[{L_Elbow:"F4D2C3",R_Elbow:"FFFFFF"}]};
  const saved={skinC:"835444",hairC:"252525",hair:"0008",fHair:"0016"};
  const result=apply(base,saved,"0");
  assert.equal(result.skinC,saved.skinC);
  assert.equal(result.hair,saved.hair);
  assert.equal(result.fHair,saved.fHair);
  assert.equal(result.accessories[0].L_Elbow,saved.skinC);
  assert.equal(result.accessories[0].R_Elbow,"FFFFFF");
  assert.equal(valid(saved,"1"),false);
  assert.equal(apply(base,{...saved,skinC:"FFFFFF"},"0"),base);
  const partial=apply(base,{hair:"0008"},"0");
  assert.equal(partial.skinC,base.skinC);
  assert.equal(partial.hair,"0008");
  const combined=combine([
    {skinC:"F4D2C3",hair:"0001"},
    {skinC:"835444",hair:"0008",fHair:"0016"},
    {skinC:"AD795C",hair:"0008",fHair:"0006"}
  ],"0");
  assert.equal(combined.skinC,"AD795C");
  assert.equal(combined.hair,"0008");
  assert.equal(combined.fHair,"0006");
});

test("download approval shares only edited fields, retries failures and does not download on cancellation", async () => {
  const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  const code=html.slice(html.indexOf("async function requestHoopLandDownload()"),html.indexOf("function syncClassDefaults()"));
  const p={fn:"AJ",ln:"Dynasty",gender:"0",sharedAppearanceIdentity:{name:"AJ Dynasty",gender:"men",type:"draft",year:"2026"},sharedAppearanceEdits:{hair:"0008"}};
  let approved=false, allowWithoutSharing=false, downloads=0, fail=false;
  const writes=[],errors=[];
  const context=vm.createContext({
    generated:[p,{fn:"Other",ln:"Player"}],URLSearchParams,window:{confirm:message=>message.startsWith("Some appearance") ? allowWithoutSharing : approved},
    downloadHoopLand:()=>downloads++,validSharedAppearance:()=>true,
    setStatus:(message)=>errors.push(message),
    fetch:async (url,options)=>{
      writes.push(JSON.parse(options.body));
      return Response.json(fail?{ok:false,error:"offline"}:{ok:true});
    }
  });
  const request=vm.runInContext(code+"\nrequestHoopLandDownload",context);
  await request();
  assert.equal(downloads,0);
  assert.equal(writes.length,0);
  approved=true;fail=true;
  await request();
  assert.equal(downloads,0);
  assert.match(errors[0],/offline/);
  assert.deepEqual(p.sharedAppearanceEdits,{hair:"0008"});
  fail=false;
  await request();
  assert.equal(downloads,1);
  assert.deepEqual(writes,[{hair:"0008"},{hair:"0008"}]);
  assert.deepEqual(p.sharedAppearanceEdits,{});
  p.sharedAppearanceEdits={hair:"0008"};fail=true;allowWithoutSharing=true;
  await request();
  assert.equal(downloads,2);
  assert.deepEqual(p.sharedAppearanceEdits,{hair:"0008"});
});

test("edit tracking shares only changed supported features of real players", () => {
  const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  const code=html.slice(html.indexOf("  function markAppearanceEdits("),html.indexOf('  document.querySelectorAll(".hl-pv-choice button")'));
  const mark=vm.runInNewContext(code+"\nmarkAppearanceEdits");
  const before={skinC:"F4D2C3",hairC:"202020",hair:"0001",fHair:"0000"};
  const p={gender:"0",sharedAppearanceIdentity:{name:"AJ Dynasty"}};
  mark(p,before,{...before,skinC:"835444"});
  assert.deepEqual({...p.sharedAppearanceEdits},{skinC:"835444"});
  mark(p,{...before,skinC:"835444"},{...before,skinC:"835444",fHair:"0016"});
  assert.deepEqual({...p.sharedAppearanceEdits},{skinC:"835444",fHair:"0016"});
  const fictional={gender:"0"};
  mark(fictional,before,{...before,hair:"0008"});
  assert.equal(fictional.sharedAppearanceEdits,undefined);
  const women={gender:"1",sharedAppearanceIdentity:{}};
  mark(women,before,{...before,fHair:"0016"});
  assert.equal(women.sharedAppearanceEdits,undefined);
});
