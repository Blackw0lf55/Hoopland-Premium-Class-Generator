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
  for(const name of ["positionPhysicalLimits","gender","classType","hlPhysHint"]) elements[name]=new Element();
  elements.gender.value="0";elements.classType.value="draft";
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
  return {api,elements};
}

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
  assert.deepEqual(Array.from(api.limits(0)),[67,70,100,150]);
  elements.classType.value="draft";elements.classType.handlers.change();
  assert.equal(elements.minHt0.value,"80");
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
