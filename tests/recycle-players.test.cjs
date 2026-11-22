const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
const code=html.slice(html.indexOf("function recycleNameKey("),html.indexOf("async function generateClass("));

function harness(gender="0",type="draft") {
  const generated=[
    {id:1,isReal:true,fn:"First",ln:"Player",edit:"keep if unselected"},
    {id:2,isReal:true,fn:"Second",ln:"Player"},
    {id:3,isReal:false,fn:"Fictional",ln:"Player"}
  ];
  const state={gender,type,year:2028,selected:new Set([0,1]),excluded:new Set(),
    tierPlan:["hof","role","bad"],candidates:[
      {fn:"First",ln:"Player"}, {fn:"Next",ln:"Prospect"}, {fn:"Next",ln:"Prospect"},
      {fn:"Another",ln:"Prospect"}, {fn:"Last",ln:"Prospect"}
    ]};
  const elements={mode:{value:"real"},gender:{value:gender},classType:{value:type},draftYear:{value:"2028"}};
  const prepared=[], renders=[];
  const context=vm.createContext({
    generated,recycleState:state,
    document:{getElementById:id=>elements[id]},
    normalizeAppearancePlayerName:name=>name.toLowerCase().replace(/[^a-z0-9]/g,""),
    surnameKey:name=>name.toLowerCase(),
    window:{__HOOPLAND_PREPARE_REAL_PLAYERS:async(players,g)=>{
      prepared.push({players:players.map(p=>p.fn),gender:g});
      players.forEach(p=>{p.prepared=true;});
    }},
    attachRosterAppearances(players,g,t,y){assert.equal(g,gender);assert.equal(t,type);assert.equal(y,2028);},
    makePlayer:(id,tier,source)=>({id,isReal:true,fn:source.fn,ln:source.ln,tier,prepared:source.prepared}),
    renderClass:()=>renders.push(true)
  });
  const recycle=vm.runInContext(code+"\nrecycleClassPlayers",context);
  return {generated,state,elements,prepared,renders,context,recycle};
}

for(const [gender,type] of [["0","draft"],["1","draft"],["1","freshman"]]) {
  test(`recycling selects next unique eligible ${gender}/${type} candidates and preserves other players`,async()=>{
    const h=harness(gender,type), untouched=h.generated[2];
    assert.equal(await h.recycle([1,0]),2);
    assert.deepEqual(h.generated.map(p=>p.fn),["Next","Another","Fictional"]);
    assert.deepEqual(h.generated.slice(0,2).map(p=>p.tier),["hof","role"]);
    assert.ok(h.generated.slice(0,2).every(p=>p.prepared));
    assert.equal(h.generated[2],untouched);
    assert.equal(h.state.selected.size,0);
    assert.equal(h.prepared[0].gender,gender);
    assert.equal(h.renders.length,1);
    h.state.candidates.unshift({fn:"First",ln:"Player"});
    assert.equal(await h.recycle([0]),1);
    assert.equal(h.generated[0].fn,"Last");
  });
}

test("recycling leaves the class intact when candidates, preparation or settings fail",async()=>{
  const h=harness(), originals=h.generated.slice(), candidates=h.state.candidates.slice();
  await assert.rejects(h.recycle([0,1,2]),/Select real players/);
  h.state.candidates=[{fn:"Only",ln:"Candidate"}];
  await assert.rejects(h.recycle([0,1]),/Not enough eligible replacement players/);
  assert.deepEqual(h.generated,originals);
  assert.equal(h.state.selected.size,2);
  h.state.candidates=candidates;
  h.context.window.__HOOPLAND_PREPARE_REAL_PLAYERS=async()=>{throw new Error("Preparation failed");};
  await assert.rejects(h.recycle([0]),/Preparation failed/);
  assert.deepEqual(h.generated,originals);
  assert.equal(h.state.candidates.length,candidates.length);
  h.elements.draftYear.value="2029";
  await assert.rejects(h.recycle([0]),/settings changed/);
  assert.deepEqual(h.generated,originals);
  assert.equal(h.renders.length,0);
});

test("recycling one player preserves edits on unselected real players",async()=>{
  const h=harness(), untouched=h.generated[0];
  assert.equal(await h.recycle([1]),1);
  assert.equal(h.generated[0],untouched);
  assert.equal(h.generated[0].edit,"keep if unselected");
  assert.equal(h.generated[1].fn,"Next");
});
