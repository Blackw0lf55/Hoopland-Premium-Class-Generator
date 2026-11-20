const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const html = fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
const code = html.slice(html.indexOf("function positionPhysicalLimits("),html.indexOf("function makePlayer("));
const positions = ["PG","G","SG","GF","SF","F","PF","FC","C"].map((name,i)=>[String(i),name]);

function harness() {
  const elements = {};
  class Element {
    constructor() { this.children=[]; this.value=""; this.handlers={}; this.attributes={}; }
    appendChild(child) { this.children.push(child); if(child.id)elements[child.id]=child; }
    append(...children) { children.forEach(child=>this.appendChild(child)); }
    replaceChildren() { this.children=[]; }
    addEventListener(type,fn) { this.handlers[type]=fn; }
    setAttribute(key,value) { this.attributes[key]=value; }
  }
  for(const name of ["positionPhysicalLimits","gender","classType","mode","hlPhysHint"]) elements[name]=new Element();
  elements.gender.value="0";elements.classType.value="draft";
  elements.mode.value="fictional";
  const context = vm.createContext({
    POS:positions, POS_PROFILE:Object.fromEntries(positions.map(([i])=>[i,[60,70,100,150,15,10]])),
    rosterCalibration:(gender,type)=>gender==="0"&&type==="freshman"?null:
      {height:gender==="0"?[72,78]:[66,72],weight:gender==="0"?[166,223]:[120,168]},
    document:{getElementById:id=>elements[id],createElement:()=>new Element()},
    clamp:(v,min,max)=>Math.min(max,Math.max(min,v)),
    rng:()=>0,randomInteger:(min,max)=>max
  });
  const api=vm.runInContext(`${code}\n({initialize:initializePositionPhysicalLimits,limits:positionPhysicalLimits,generate:generatePlayerDimensions})`,context);
  api.initialize();
  return {api,elements,context};
}

test("freshman defaults use men's draft and women's college reference ranges", () => {
  const {api,elements,context}=harness();
  const referenceContext={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"..","data/roster-reference.js"),"utf8"),referenceContext);
  const references=referenceContext.window.HOOPLAND_ROSTER_REFERENCE.calibration;
  context.rosterCalibration=(gender,type,position)=>type==="draft"
    ? references[gender==="1"?"wnba":"nba"][Math.floor(position/3)]
    : gender==="1"?references.ncaaw[Math.floor(position/3)]:null;
  for (const [gender,type,key] of [["0","freshman","nba"],["1","draft","wnba"],["1","freshman","ncaaw"]]) {
    elements.classType.value=type;
    elements.gender.value=gender;elements.gender.handlers.change();elements.classType.handlers.change();
    for(let position=0;position<9;position++){
      const expected=[...references[key][Math.floor(position/3)].height,...references[key][Math.floor(position/3)].weight];
      if(position===0)expected[0]=67;
      assert.deepEqual(Array.from(api.limits(position)),expected);
      const generated=api.generate(position,gender,null);
      assert.ok(generated.height>=expected[0]&&generated.height<=expected[1]);
      assert.ok(generated.weight>=expected[2]&&generated.weight<=expected[3]);
    }
  }
  assert.ok(api.limits(8)[0] < references.nba[2].height[0]);
});

test("position controls use named recommended ranges and preserve context-specific edits", () => {
  const {api,elements}=harness();
  assert.equal(elements.positionPhysicalLimits.children.length,9);
  assert.equal(elements.positionPhysicalLimits.children[0].children[0].textContent,"PG");
  assert.equal(elements.positionPhysicalLimits.children[8].children[0].textContent,"C");
  assert.equal(elements.minHt0.attributes["aria-label"],"PG Min height (in)");
  assert.deepEqual(Array.from(api.limits(0)),[67,78,166,223]);
  elements.minHt0.value="80";elements.minHt0.handlers.input();
  elements.gender.value="1";elements.gender.handlers.change();
  assert.deepEqual(Array.from(api.limits(0)),[67,72,120,168]);
  elements.gender.value="0";elements.gender.handlers.change();
  assert.equal(elements.minHt0.value,"80");
  elements.classType.value="freshman";elements.classType.handlers.change();
  assert.deepEqual(Array.from(api.limits(0)),[67,78,166,223]);
  elements.minHt8.value="82";elements.minHt8.handlers.input();
  elements.maxHt8.value="84";elements.maxHt8.handlers.input();
  elements.minWt8.value="225";elements.minWt8.handlers.input();
  elements.maxWt8.value="250";elements.maxWt8.handlers.input();
  assert.deepEqual({...api.generate(8,"0",null)},{height:84,weight:250,giantOutlier:true});
  elements.classType.value="draft";elements.classType.handlers.change();
  assert.equal(elements.minHt0.value,"80");
  elements.classType.value="freshman";elements.classType.handlers.change();
  assert.deepEqual(Array.from(api.limits(8)),[82,84,225,250]);
  elements.classType.value="draft";elements.classType.handlers.change();
  elements.gender.value="1";elements.gender.handlers.change();
  elements.classType.value="freshman";elements.classType.handlers.change();
  assert.equal(api.limits(0)[0],67);
  elements.minHt0.value="62";elements.minHt0.handlers.input();
  assert.equal(api.limits(0)[0],62);
  elements.gender.value="0";elements.gender.handlers.change();
  elements.gender.value="1";elements.gender.handlers.change();
  assert.equal(api.limits(0)[0],62);
});

test("each position's limits constrain fictional, outlier and sourced heights", () => {
  const {api,elements}=harness();
  for(let position=0;position<9;position++){
    const min=65+position,max=min+2,lo=130+position,hi=lo+10;
    for(const [field,value] of [["minHt",min],["maxHt",max],["minWt",lo],["maxWt",hi]])
      elements[field+position].value=String(value);
    for(const gender of ["0","1"]){
      for(const source of [null,{height:55},{height:95}]){
        const p=api.generate(position,gender,source);
        assert.ok(p.height>=min&&p.height<=max,positions[position][1]);
        assert.ok(p.weight>=lo&&p.weight<=hi,positions[position][1]);
      }
    }
  }
  elements.minHt8.value="100";elements.maxHt8.value="105";
  const giant=api.generate(8,"0",null);
  assert.equal(giant.giantOutlier,true);
  assert.ok(giant.height>=100&&giant.height<=105);
});

test("invalid inputs report the affected position, without silently substituting defaults", () => {
  const {api,elements}=harness();
  elements.maxHt4.value="60";
  assert.throws(()=>api.limits(4),/SF: minimum height or weight/);
  elements.maxHt4.value="";
  assert.throws(()=>api.limits(4),/SF: height and weight limits must be positive whole numbers/);
  elements.maxHt4.value="76.5";
  assert.throws(()=>api.limits(4),/positive whole numbers/);
});

test("real players preserve sourced dimensions independently of fictional edits", () => {
  const {api,elements}=harness();
  elements.minHt0.value="100";elements.maxHt0.value="101";
  elements.minWt0.value="300";elements.maxWt0.value="301";
  elements.mode.value="real";
  assert.deepEqual({...api.generate(0,"0",{height:65})},{height:65,weight:223,giantOutlier:false});
  assert.deepEqual({...api.generate(0,"0",{height:80,weight:240})},{height:80,weight:240,giantOutlier:false});
  assert.deepEqual({...api.generate(0,"0",{height:0,weight:250})},{height:78,weight:250,giantOutlier:false});
  assert.deepEqual({...api.generate(8,"0",{height:null,weight:null})},{height:78,weight:223,giantOutlier:false});
  assert.deepEqual({...api.generate(0,"0",null)},{height:78,weight:223,giantOutlier:false});
  elements.maxHt0.value="";
  assert.equal(api.generate(0,"0",{height:81}).height,81);
});

test("legacy draft biography merging preserves measurements when no biography matches", () => {
  const worker=fs.readFileSync(path.join(__dirname,"..","worker.js"),"utf8");
  const mergeCode=worker.slice(worker.indexOf("function mergeDraftBiographies("),worker.indexOf("export default {"));
  const merge=vm.runInNewContext(mergeCode+"\nmergeDraftBiographies",{
    normalizePlayerName:name=>name.toLowerCase().replace(/[^a-z0-9]/g,"")
  });
  const [unmatched,matched]=merge([
    {fn:"One",ln:"Player",height:74,weight:170},
    {fn:"Two",ln:"Player",height:70,weight:165}
  ],[{nameKey:"twoplayer",height:72,sourcePosition:"G"}]);
  assert.equal(unmatched.height,74);
  assert.equal(unmatched.weight,170);
  assert.equal(matched.height,72);
});
