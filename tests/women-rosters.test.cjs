const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.join(__dirname,"..");
const env={ASSETS:{fetch:async request=>{
  const name=new URL(request.url).pathname;
  return new Response(fs.readFileSync(path.join(root,name)));
}}};

test("school roster verifies season-specific classes and jersey numbers", async()=>{
  const {womenRosterLookup,womenRosterCandidates}=await import("../women-rosters.js");
  const {verifyWomenDraftSenior}=await import("../location-worker.js");
  const soph={fn:"Jazzy",ln:"Davidson"};
  const senior={fn:"JuJu",ln:"Watkins"};
  assert.equal(await verifyWomenDraftSenior(soph,2027,env),false);
  assert.equal(soph.jersey,"9");
  assert.equal(await verifyWomenDraftSenior(senior,2027,env),true);
  assert.equal(senior.jersey,"12");
  assert.equal(await womenRosterLookup(env,2030,senior),null);
  const candidates=await womenRosterCandidates(env,2027);
  assert.ok(candidates.length>100);
  assert.ok(!candidates.some(p=>p.fn==="Jazzy"&&p.ln==="Davidson"));
  assert.ok(candidates.every(p=>Number.isFinite(p.rosterMinutes)&&p.rosterMinutes>0));
});

test("unknown and duplicate names never receive a guessed college classification", async()=>{
  const {womenRosterLookup,womenRosterCandidates}=await import("../women-rosters.js");
  const data={"2027":[
    ["Alex Smith","One","Senior","00","G","USA","https://one.edu/a"],
    ["Alex Smith","Two","Sophomore","5","F","USA","https://two.edu/a"],
    ["Other Senior","One","Senior","7","G","USA","https://one.edu/b"]
  ]};
  const fake={ASSETS:{fetch:async r=>Response.json(new URL(r.url).pathname.includes("college-women")
    ? {"2027":[{n:"Alex Smith",t:"One Team",g:5,m:30},{n:"Other Senior",t:"One Team",g:5,m:30}]}
    : data)}};
  assert.equal(await womenRosterLookup(fake,2027,{fn:"Alex",ln:"Smith"}),null);
  assert.equal(await womenRosterLookup(fake,2027,{fn:"Unknown",ln:"Player"}),null);
  const candidates=await womenRosterCandidates(fake,2027);
  assert.deepEqual(candidates.map(p=>p.ln),["Senior"]);
  assert.equal(candidates[0].jersey,"7");
});

test("2027 draft uses published seniors even when external services fail", async()=>{
  const {default:worker}=await import("../location-worker.js");
  const oldFetch=global.fetch, oldWarn=console.warn;
  try {
    global.fetch=async()=>new Response("",{status:503});
    console.warn=()=>{};
    const response=await worker.fetch(new Request("https://example.test/api/class-data?type=draft&gender=women&year=2027"),env);
    const body=await response.json();
    assert.equal(response.status,200);
    assert.ok(body.players.length>100);
    assert.deepEqual(body.players.slice(0,2).map(p=>[p.fn,p.ln,p.jersey,p.projectedPick]),
      [["JuJu","Watkins","12",1],["Hannah","Hidalgo","3",2]]);
    assert.ok(!body.players.some(p=>p.ln==="Davidson"&&p.fn==="Jazzy"));
    assert.match(body.warning,/prior draft results.*could not be verified/i);
  } finally {global.fetch=oldFetch;console.warn=oldWarn;}
});
