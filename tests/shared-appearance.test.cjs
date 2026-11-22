const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("preview deployments use local appearance storage", () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../wrangler.jsonc"), "utf8"));
  assert.deepEqual(config.previews.durable_objects.bindings, [
    {name: "APPEARANCES", class_name: "SharedAppearance"}
  ]);
  assert.equal(config.previews.ai, undefined);
  assert.equal(config.ai, undefined);
  assert.ok(config.migrations.some(migration => migration.new_sqlite_classes?.includes("SharedAppearance")));
});

test("imported player data is scoped by year and level and merges duplicate attributes conservatively", async () => {
  const {default:worker,SharedAppearance}=await import("../location-worker.js");
  const objects=new Map();
  const env={APPEARANCES:{idFromName:name=>name,get:id=>{
    if(!objects.has(id)){
      const values=new Map();
      let lock=Promise.resolve();
      const storage={get:async k=>values.get(k),put:async(k,v)=>values.set(k,v),
        transaction:fn=>{const task=lock.then(()=>fn(storage));lock=task.catch(()=>{});return task;}};
      objects.set(id,new SharedAppearance({storage}));
    }
    return {fetch:(url,init)=>objects.get(id).fetch(new Request(url,init))};
  }}};
  const url="https://example.test/api/imported-roster?"+new URLSearchParams({name:"Test Player",gender:"men",type:"pro",year:"2020"});
  const put=(body,origin="https://example.test")=>worker.fetch(new Request(url,{method:"PUT",
    headers:{origin,"content-type":"application/json"},body:JSON.stringify(body)}),env);
  const first={attributes:{LAY:[12,18],MID:[10,16]},bio:{age:20},tendencies:{pass:2}};
  const second={attributes:{LAY:[10,19],MID:[12,14]},bio:{age:22},tendencies:{pass:4}};
  assert.equal((await put(first,"https://other.example")).status,403);
  assert.equal((await put({...first,attributes:{LAY:[20,2]}})).status,400);
  assert.equal((await put({...first,bio:{unexpected:"secret"}})).status,400);
  assert.equal((await put(first)).status,200);
  assert.equal((await put(second)).status,200);
  const loaded=await (await worker.fetch(new Request(url),env)).json();
  assert.deepEqual(loaded.player,{attributes:{LAY:[10,18],MID:[10,14]},bio:{age:20},tendencies:{pass:2}});
  for (const changed of [url.replace("2020","2021"),url.replace("type=pro","type=college"),url.replace("gender=men","gender=women")])
    assert.equal((await (await worker.fetch(new Request(changed),env)).json()).player,null);
});

test("community looks persist per player and gender across class years, with five-edit limit", async () => {
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
  for (const changed of [url.replace("2026","2027"),url.replace("draft","freshman")])
    assert.deepEqual((await (await worker.fetch(new Request(changed),env)).json()).appearances,[look]);
  assert.deepEqual((await (await worker.fetch(new Request(url.replace("men","women")),env)).json()).appearances,[]);
  assert.equal((await put(url.replace("men","women"),look)).status,400);
  const next={...look,hair:"0008"};
  assert.equal((await put(url,next)).status,200);
  for(let i=0;i<5;i++) assert.equal((await put(url,{hair:"000"+i})).status,200);
  assert.deepEqual((await (await worker.fetch(new Request(url),env)).json()).appearances,
    Array.from({length:5},(_,i)=>({hair:"000"+i})));
  assert.equal((await worker.fetch(new Request(url),{})).status,503);
});

test("imported baselines are first-write-only, preserve edits and skip built-in references", async () => {
  const {default:worker,SharedAppearance} = await import("../location-worker.js");
  const objects=new Map();
  const asset=fs.readFileSync(path.join(__dirname,"..","data/roster-reference.js"),"utf8");
  const env={ASSETS:{fetch:async()=>new Response(asset)},APPEARANCES:{
    idFromName:name=>name,
    get:id=>{
      if(!objects.has(id)){
        const values=new Map();
        let lock=Promise.resolve();
        const storage={get:async k=>values.get(k),put:async(k,v)=>values.set(k,v),
          transaction:fn=>{const task=lock.then(()=>fn(storage));lock=task.catch(()=>{});return task;}};
        objects.set(id,new SharedAppearance({storage}));
      }
      return {fetch:(url,init)=>objects.get(id).fetch(new Request(url,init))};
    }
  }};
  const base="https://example.test/api/appearance-baseline?"+new URLSearchParams({name:"Test Prospect",gender:"men",type:"pro",year:"2027"});
  const edits="https://example.test/api/shared-appearance?"+new URLSearchParams({name:"Test Prospect",gender:"men",type:"draft",year:"2025"});
  const put=(url,body,origin="https://example.test")=>worker.fetch(new Request(url,{
    method:"PUT",headers:{"content-type":"application/json",origin},body:JSON.stringify(body)}),env);
  const look={skinC:"123456",hairC:"123456",hair:"0001",fHair:"0016"};
  assert.equal((await put(base,look,"https://other.example")).status,403);
  assert.equal((await put(base,{hair:"0001"})).status,400);
  const [a,b]=await Promise.all([put(base,look),put(base,{...look,hair:"0002"})]);
  const results=await Promise.all([a.json(),b.json()]);
  assert.equal(results.filter(r=>r.saved).length,1);
  assert.equal((await put(edits,{hair:"0003"})).status,200);
  const fetched=await (await worker.fetch(new Request(edits.replace("2025","2030")),env)).json();
  assert.deepEqual(fetched.appearances,[{hair:"0003"}]);
  assert.ok(["0001","0002"].includes(fetched.baseline.appearance.hair));
  assert.deepEqual(fetched.baseline.source,{type:"pro",year:2027});
  const builtin=base.replace("Test+Prospect","Azzi+Fudd").replace("gender=men","gender=women");
  const existing=await (await put(builtin,{skinC:"123456",hairC:"123456",hair:"0001"})).json();
  assert.equal(existing.saved,false);
  assert.equal(existing.reason,"built-in reference");
});

test("old class-scoped edits remain readable and seed the global history on first edit", async () => {
  const {default:worker,SharedAppearance}=await import("../location-worker.js");
  const objects=new Map();
  const legacyId=JSON.stringify(["men","draft",2026,"legacy player"]);
  const env={APPEARANCES:{idFromName:name=>name,get:id=>{
    if(!objects.has(id)){
      const values=new Map(id===legacyId?[["appearances",[{hair:"0001"}]]]:[]);
      const storage={get:async k=>values.get(k),put:async(k,v)=>values.set(k,v)};
      storage.transaction=fn=>fn(storage);
      objects.set(id,new SharedAppearance({storage}));
    }
    return {fetch:(url,init)=>objects.get(id).fetch(new Request(url,init))};
  }}};
  const url="https://example.test/api/shared-appearance?"+new URLSearchParams({name:"Legacy Player",gender:"men",type:"draft",year:"2026"});
  assert.deepEqual((await (await worker.fetch(new Request(url),env)).json()).appearances,[{hair:"0001"}]);
  await worker.fetch(new Request(url,{method:"PUT",headers:{origin:"https://example.test","content-type":"application/json"},body:JSON.stringify({hair:"0002"})}),env);
  assert.deepEqual((await (await worker.fetch(new Request(url.replace("2026","2027")),env)).json()).appearances,[{hair:"0001"},{hair:"0002"}]);
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

test("download approvals independently share, skip, return to editing and retry failures", async () => {
  const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  const code=html.slice(html.indexOf("async function requestHoopLandDownload()"),html.indexOf("function syncClassDefaults()"));
  const p={fn:"AJ",ln:"Dynasty",gender:"0",pos:0,sharedAppearanceIdentity:{name:"AJ Dynasty",gender:"men",type:"draft",year:"2026"},sharedAppearanceEdits:{hair:"0008"},sharedRatingEdits:{LAY:[10,14]}};
  let answers=["no"], downloads=0, fail=false;
  const writes=[],errors=[];
  const context=vm.createContext({
    generated:[p,{fn:"Other",ln:"Player"}],URLSearchParams,askDownloadApproval:async()=>answers.shift(),
    downloadHoopLand:()=>downloads++,validSharedAppearance:()=>true,
    validSharedRating:()=>true,
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
  answers=["yes","no"];
  await request();
  assert.equal(downloads,0);
  assert.equal(writes.length,0);
  answers=["yes","skip"];fail=true;
  await request();
  assert.equal(downloads,0);
  assert.match(errors[0],/offline/);
  assert.deepEqual(p.sharedAppearanceEdits,{hair:"0008"});
  answers=["yes","yes"];fail=false;
  await request();
  assert.equal(downloads,1);
  assert.deepEqual(writes,[{hair:"0008"},{hair:"0008"},{LAY:[10,14]}]);
  assert.deepEqual(p.sharedAppearanceEdits,{});
  assert.deepEqual(p.sharedRatingEdits,{});
  p.sharedAppearanceEdits={hair:"0008"};p.sharedRatingEdits={LAY:[10,14]};
  answers=["skip","skip"];fail=true;
  await request();
  assert.equal(downloads,2);
  assert.deepEqual(p.sharedAppearanceEdits,{hair:"0008"});
  assert.deepEqual(p.sharedRatingEdits,{LAY:[10,14]});
});

test("shared ratings persist separately from appearances and validate values", async () => {
  const {default:worker,SharedAppearance}=await import("../location-worker.js");
  const objects=new Map();
  const env={APPEARANCES:{idFromName:name=>name,get:id=>{
    if(!objects.has(id)){
      const values=new Map();
      const storage={get:async k=>values.get(k),put:async(k,v)=>values.set(k,v)};
      storage.transaction=fn=>fn(storage);
      objects.set(id,new SharedAppearance({storage}));
    }
    return {fetch:(url,init)=>objects.get(id).fetch(new Request(url,init))};
  }}};
  const url="https://example.test/api/shared-attributes?"+new URLSearchParams({name:"Test Player",gender:"men",type:"draft",year:"2025"});
  const put=body=>worker.fetch(new Request(url,{method:"PUT",headers:{origin:"https://example.test","content-type":"application/json"},body:JSON.stringify(body)}),env);
  assert.equal((await put({LAY:[12,10]})).status,400);
  assert.equal((await put({SPD:[7,7]})).status,400);
  assert.equal((await put({arc:"Unknown"})).status,400);
  assert.equal((await put({LAY:[10,14],SPD:[16,16],arc:"Floor General"})).status,200);
  const result=await (await worker.fetch(new Request(url.replace("2025","2030")),env)).json();
  assert.deepEqual(result.ratings,[{LAY:[10,14],SPD:[16,16],arc:"Floor General"}]);
  const different=await (await worker.fetch(new Request(url.replace("men","women")),env)).json();
  assert.deepEqual(different.ratings,[]);
  const appearance=await (await worker.fetch(new Request(url.replace("shared-attributes","shared-appearance")),env)).json();
  assert.deepEqual(appearance.appearances,[]);
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
