const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");

test("draft starter skills reflect ability, exclude women's dunk skill and retain game export structure", async () => {
  const code=html.slice(html.indexOf("function starterSkills("),html.indexOf("function makePlayer("));
  const context=vm.createContext({rng:()=>0,weightedPick:items=>items[items.length-1][0]});
  const generate=vm.runInContext(code+"\nstarterSkills",context);
  const attrs={DNK:[12,12],PAS:[12,12],STL:[12,12],BLK:[12,12]};
  assert.deepEqual(JSON.parse(JSON.stringify(generate("draft","0",4,attrs))),[{id:"HIG",xp:0,level:1,equipped:true}]);
  assert.equal(generate("draft","1",4,attrs)[0].id,"DIM");
  assert.equal(generate("freshman","0",5,attrs).length,0);
  context.rng=()=>0.5;
  assert.equal(generate("draft","0",2,attrs).length,0);
  assert.equal(generate("draft","0",4,attrs).length,1);
  const {default:worker}=await import("../location-worker.js");
  const csv=fs.readFileSync(path.join(__dirname,"..","data/location-catalog.csv"),"utf8");
  const env={ASSETS:{fetch:async r=>new URL(r.url).pathname.endsWith(".csv")?new Response(csv):new Response(html)}};
  const page=await (await worker.fetch(new Request("https://example.test/"),env)).text();
  const exportCode=page.slice(page.indexOf("function makeHoopLandPlayer("),page.indexOf("function downloadHoopLand()"));
  const grayscale=html.slice(html.indexOf("function grayscalePlayerAppearance("),html.indexOf("function validSharedRating("));
  const exportPlayer=vm.runInNewContext(grayscale+"\n"+exportCode+"\nmakeHoopLandPlayer",{
    window:{__HOOPLAND_RESOLVE_LOCATION:()=>({home:"",loc:{x:1,y:2}})},
    randomInteger:()=>1,document:{getElementById:()=>({value:"0"})},makeEmptyStatLine:()=>({}),
    colorLum:hex=>.299*parseInt(hex.slice(0,2),16)+.587*parseInt(hex.slice(2,4),16)+.114*parseInt(hex.slice(4,6),16)
  });
  const skills=[{id:"CLA",xp:0,level:1,equipped:true}];
  const p={fn:"A",ln:"B",ctry:"US",age:20,ht:78,wt:200,year:1,pos:4,arc:"x",pot:8,regressionAge:32,
    appearance:{skinC:"AD795C",eyeC:"090502",browC:"202020",hair:"0001",hairC:"202020",fHair:"0000",fHairC:"202020",accessories:[]},
    attributes:{},physical:{STR:10,SPD:10,STA:10},tendencies:{},skills};
  assert.deepEqual(JSON.parse(JSON.stringify(exportPlayer(p,0).skills)),skills);
  p.grayscale=true;
  p.appearance.accessories=[{headAccC:"PRI",shoeC:"FF5533",L_Elbow:"AD795C"}];
  const historical=exportPlayer(p,0);
  for(const [key,value] of Object.entries(historical.suits[0])) {
    if(key.endsWith("C") && value) assert.match(value,/^([0-9A-F]{2})\1\1$/i,key);
  }
  for(const value of Object.values(historical.accessories[0])) assert.match(value,/^([0-9A-F]{2})\1\1$/i);
  assert.deepEqual(Array.from(historical.attributes.SPD),[10,10]);
});

test("fictional tattoos and sleeves are frequent and shoe parts use varied colors", () => {
  const constants=html.slice(html.indexOf("const SHOE_COLORS="),html.indexOf("function padStyle("));
  const functions=html.slice(html.indexOf("function padStyle("),html.indexOf("let rng = Math.random;"));
  const api=vm.runInNewContext(`${constants}
    let seed=12345; let rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
    function randomInteger(a,b){return a+Math.floor(rng()*(b-a+1))} function pick(a){return a[randomInteger(0,a.length-1)]}
    const PRIMARY_ACCESSORIES=[18,19],SECONDARY_ACCESSORIES=[5,6];
    const document={getElementById:()=>({checked:true})};
    ${functions}
    ({buildAccessories,SHOE_COLORS})`);
  let tattoos=0,sleeves=0;
  const shoes=new Set(),laces=new Set(),soles=new Set();
  for(let i=0;i<5000;i++){
    const shoe=api.SHOE_COLORS[i%api.SHOE_COLORS.length];
    const a=api.buildAccessories("AD795C","433029","0",shoe,true)[0];
    if(Object.entries(a).some(([k,v])=>/^[LR]_/.test(k)&&v==="433029"))tattoos++;
    if(["L_Shoulder","R_Shoulder","L_Elbow","R_Elbow","L_Wrist","R_Wrist","L_Knee","R_Knee"].some(k=>["PRI","SEC","TER"].includes(a[k])))sleeves++;
    assert.ok(["PRI","SEC","TER"].includes(a.headAccC));
    if(a.headAcc2!=="0000")assert.ok(["PRI","SEC","TER"].includes(a.headAcc2C));
    shoes.add(a.shoeC);laces.add(a.laceC);soles.add(a.soleC);
  }
  assert.ok(tattoos/5000>0.30 && tattoos/5000<0.36,tattoos);
  assert.ok(sleeves/5000>0.40,sleeves);
  assert.ok(shoes.size>=20&&laces.size>=20&&soles.size>=20);
  const real=api.buildAccessories("AD795C","433029","0","FFFFFF",false)[0];
  assert.ok(!Object.entries(real).some(([k,v])=>/^[LR]_/.test(k)&&v==="433029"));
});

test("physical ratings respect positional speed limits and rare elite exceptions", () => {
  const profileCode=html.slice(html.indexOf("const POS_PROFILE ="),html.indexOf("const NBA_COUNTRY_COUNTS ="));
  const code=html.slice(html.indexOf("function generatePhysicalRatings("),html.indexOf("function colorLum("));
  const api=vm.runInNewContext(`${profileCode}
    let seed=1234567;
    const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
    function normalRandom(){return (rng()+rng()+rng()+rng()+rng()+rng()-3)*1.414}
    function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
    ${code}
    ({generate:generatePhysicalRatings,profiles:POS_PROFILE})`);
  const mins=[12,12,12,10,10,10,8,8,8], maxes=[20,19,18,17,16,15,14,13,12];
  for(let position=0;position<9;position++){
    let boost=0,eliteSpeed=0,eliteStrength=0;
    for(let i=0;i<120000;i++){
      const p=api.profiles[position];
      const result=api.generate(position,(p[0]+p[1])/2,(p[2]+p[3])/2,p);
      assert.ok(result.SPD>=mins[position]&&result.SPD<=Math.min(20,maxes[position]+(position===0||position===2?0:2)));
      assert.ok(result.STR>=8&&result.STR<=20&&result.STA>=8&&result.STA<=20);
      if(result.SPD>maxes[position])boost++;
      if(result.SPD===20)eliteSpeed++;
      if(result.STR===20)eliteStrength++;
    }
    if(position===0||position===2)assert.equal(boost,0);
    else assert.ok(boost>0&&boost<3000,`position ${position}: ${boost}`);
    if(position>1)assert.equal(eliteSpeed,0);
    else assert.ok(eliteSpeed>0&&eliteSpeed<600);
    if(position!==8)assert.equal(eliteStrength,0);
    else assert.ok(eliteStrength>0&&eliteStrength<600);
  }
});

test("historical appearance colors are grayscale and era rules follow league adoption", () => {
  const code=html.slice(html.indexOf("function grayscalePlayerAppearance("),html.indexOf("function makePlayer("));
  const api=vm.runInNewContext(`
    const ATTRS=["LAY","DNK","INS","MID","TPT","FTS","DRB","PAS","ORE","DRE","STL","BLK"].map(x=>[x,x]);
    function starsForBudget(p){return Math.max(0,Math.min(5,Math.round(p/14)/2))}
    function colorLum(hex){const c=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));return .299*c[0]+.587*c[1]+.114*c[2]}
    ${code}
    ({gray:grayscalePlayerAppearance,era:applyEraRules,attrs:ATTRS})`);
  const appearance=api.gray({skinC:"A06030",eyeC:"132D44",browC:"141020",hairC:"602040",fHairC:"202020",
    accessories:[{L_Elbow:"PRI",R_Elbow:"E37033",headAcc:"0018",headAccC:"SEC",shoeC:"DBE0E7",laceC:"FFFFFF",soleC:"TER"}]});
  for(const field of ["skinC","eyeC","browC","hairC","fHairC"])
    assert.match(appearance[field],/^([0-9A-F]{2})\1\1$/);
  for(const field of ["L_Elbow","R_Elbow","headAccC","shoeC","laceC","soleC"])
    assert.match(appearance.accessories[0][field],/^([0-9A-F]{2})\1\1$/);
  assert.equal(appearance.accessories[0].headAcc,"0018");
  const make=()=>({attributes:Object.fromEntries(api.attrs.map(([code])=>[code,[10,14]])),tendencies:{},skills:[{id:"HIG"}]});
  const before=make();api.era(before,"draft","0",1978);
  assert.deepEqual(Array.from(before.attributes.TPT),[2,2]);assert.equal(before.tendencies.threePoint,-5);
  const after=make();api.era(after,"draft","0",1979);assert.deepEqual(after.attributes.TPT,[10,14]);
  const banned=make();api.era(banned,"freshman","0",1975);
  assert.deepEqual(Array.from(banned.attributes.DNK),[2,2]);assert.equal(banned.tendencies.dunk,-5);
  assert.equal(banned.skills.length,0);
  assert.equal(banned.currentPoints,api.attrs.length*8-16);
  const legal=make();api.era(legal,"freshman","0",1976);assert.deepEqual(legal.attributes.DNK,[10,14]);
  const women=make();api.era(women,"freshman","1",1986);assert.deepEqual(Array.from(women.attributes.TPT),[2,2]);
  const womenLater=make();api.era(womenLater,"freshman","1",1987);assert.deepEqual(womenLater.attributes.TPT,[10,14]);
});

test("historical roster reference preserves sample-derived tendencies and appearance", () => {
  const script=fs.readFileSync(path.join(__dirname,"..","data/historical-reference.js"),"utf8");
  const context={window:{}};
  vm.runInNewContext(script,context);
  const ref=context.window.HOOPLAND_HISTORICAL_REFERENCE;
  assert.equal(ref.season,"1965-66");
  assert.equal(ref.calibration.reduce((sum,g)=>sum+g.n,0),33);
  assert.equal(ref.appearances.billrussell.skinC,"5A5A5A");
  assert.equal(ref.calibration[0].tendencies.threePoint,-5);
});
