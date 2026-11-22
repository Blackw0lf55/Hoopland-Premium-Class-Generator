const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
const validator=html.slice(html.indexOf("function validImportedBaseline("),html.indexOf("function combineSharedAppearances("));
const names=html.slice(html.indexOf("  function normalizeAppearancePlayerName("),html.indexOf("  function hairMatchScore("));
const code=html.slice(html.indexOf("function collectAppearanceImports("),html.indexOf("function initializeAppearanceImport("));
const requests=[];
const context=vm.createContext({URLSearchParams,fetch:async(url,options)=>{
  const name=new URLSearchParams(url.split("?")[1]).get("name");
  requests.push({url,body:JSON.parse(options.body)});
  if(name==="Error Player")return Response.json({ok:false,error:"Storage unavailable"},{status:503});
  return Response.json({ok:true,saved:name!=="Existing Player"});
}});
const api=vm.runInContext(`${validator}\n${names}\n${code}\n({collect:collectAppearanceImports,importFile:importAppearanceFile})`,context);
const look={skinC:"123456",hairC:"123456",hair:"0001",fHair:"0016",eyeC:"000000"};
const player=(fn,ln,appearance=look)=>({fn,ln,appearance,attributes:{LAY:[20,20]},home:"Do not upload",regressionAge:18});

test("import extracts only valid appearance fields and skips every ambiguous name", () => {
  const data={teams:[{roster:[player("Same","Name"),player("First","Player")]}],
    freeAgents:[player("Same","Name"),player("Bad","Player",{...look,hair:"9000"})]};
  const result=api.collect(data,"women");
  assert.equal(result.ambiguous,2);
  assert.equal(result.invalid,1);
  assert.equal(result.candidates.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(result.candidates[0])),{
    name:"First Player",appearance:{skinC:"123456",hairC:"123456",hair:"0001"}});
  assert.throws(()=>api.collect({teams:[{}]},"men"),/missing its roster/);
  assert.throws(()=>api.collect({coaches:[]},"men"),/No roster/);
});

test("large roster files upload selected player data, report failures and skip saved baselines", async () => {
  requests.length=0;
  const json=JSON.stringify({teams:[{roster:[player("New","Player"),player("Existing","Player"),player("Error","Player")]}],
    unused:"x".repeat(34*1024*1024)});
  const progress=[];
  const result=await api.importFile({name:"large.txt",size:Buffer.byteLength(json),text:async()=>json},
    "men","pro",2027,(done,total)=>progress.push([done,total]));
  assert.equal(result.saved,2);
  assert.equal(result.skipped,2);
  assert.equal(result.failed,2);
  assert.match(result.errors[0],/Storage unavailable/);
  assert.deepEqual(progress[0],[0,6]);
  assert.deepEqual(progress[progress.length-1],[6,6]);
  assert.equal(requests.length,6);
  assert.deepEqual(requests[0].body,{skinC:"123456",hairC:"123456",hair:"0001",fHair:"0016"});
  const uploaded=requests.find(r=>r.url.startsWith("/api/imported-roster"));
  assert.deepEqual(uploaded.body,{attributes:{LAY:[20,20]},bio:{home:"Do not upload"},tendencies:{}});
  assert.ok(requests.every(item=>!("regressionAge" in item.body)));
});

test("invalid files and oversized files return clear errors before upload", async () => {
  await assert.rejects(api.importFile({name:"bad.txt",size:2,text:async()=>"{x"},"men","pro",2027,()=>{}),/not valid JSON/);
  await assert.rejects(api.importFile({name:"large.txt",size:257*1024*1024},"men","pro",2027,()=>{}),/256 MB/);
  await assert.rejects(api.importFile({name:"a.csv",size:1},"men","pro",2027,()=>{}),/json or .txt/);
});

test("invalid imported roster fields are omitted and reported", async () => {
  requests.length=0;
  const data={players:[{...player("New","Player"),attributes:{LAY:[20,2],PAS:[10,14]},
    tendencies:{pass:9,dunk:2},age:200}]};
  const json=JSON.stringify(data);
  const result=await api.importFile({name:"roster.json",size:json.length,text:async()=>json},
    "men","pro",2027,()=>{});
  assert.equal(result.discarded,1);
  const uploaded=requests.find(item=>item.url.startsWith("/api/imported-roster")).body;
  assert.deepEqual(uploaded.attributes,{PAS:[10,14]});
  assert.deepEqual(uploaded.tendencies,{dunk:2});
  assert.equal(uploaded.bio.age,undefined);
});
