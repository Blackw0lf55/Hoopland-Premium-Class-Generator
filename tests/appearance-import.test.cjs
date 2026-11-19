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
const player=(fn,ln,appearance=look)=>({fn,ln,appearance,attributes:{LAY:[20,20]},home:"Do not upload"});

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

test("large roster files upload only appearance fields, report failures and skip saved baselines", async () => {
  requests.length=0;
  const json=JSON.stringify({teams:[{roster:[player("New","Player"),player("Existing","Player"),player("Error","Player")]}],
    unused:"x".repeat(34*1024*1024)});
  const progress=[];
  const result=await api.importFile({name:"large.txt",size:Buffer.byteLength(json),text:async()=>json},
    "men","pro",2027,(done,total)=>progress.push([done,total]));
  assert.equal(result.saved,1);
  assert.equal(result.skipped,1);
  assert.equal(result.failed,1);
  assert.match(result.errors[0],/Storage unavailable/);
  assert.deepEqual(progress[progress.length-1],[3,3]);
  assert.equal(requests.length,3);
  assert.deepEqual(requests[0].body,{skinC:"123456",hairC:"123456",hair:"0001",fHair:"0016"});
  assert.ok(requests.every(r=>!JSON.stringify(r.body).includes("attributes")));
});

test("invalid files and oversized files return clear errors before upload", async () => {
  await assert.rejects(api.importFile({name:"bad.txt",size:2,text:async()=>"{x"},"men","pro",2027,()=>{}),/not valid JSON/);
  await assert.rejects(api.importFile({name:"large.txt",size:257*1024*1024},"men","pro",2027,()=>{}),/256 MB/);
  await assert.rejects(api.importFile({name:"a.csv",size:1},"men","pro",2027,()=>{}),/json or .txt/);
});
