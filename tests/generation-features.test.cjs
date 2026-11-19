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
  const exportPlayer=vm.runInNewContext(exportCode+"\nmakeHoopLandPlayer",{
    window:{__HOOPLAND_RESOLVE_LOCATION:()=>({home:"",loc:{x:1,y:2}})},
    randomInteger:()=>1,document:{getElementById:()=>({value:"0"})},makeEmptyStatLine:()=>({})
  });
  const skills=[{id:"CLA",xp:0,level:1,equipped:true}];
  const p={fn:"A",ln:"B",ctry:"US",age:20,ht:78,wt:200,year:1,pos:4,arc:"x",pot:8,regressionAge:32,
    appearance:{skinC:"AD795C",eyeC:"090502",browC:"202020",hair:"0001",hairC:"202020",fHair:"0000",fHairC:"202020",accessories:[]},
    attributes:{},physical:{STR:10,SPD:10,STA:10},tendencies:{},skills};
  assert.deepEqual(JSON.parse(JSON.stringify(exportPlayer(p,0).skills)),skills);
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
    if(["L_Shoulder","R_Shoulder","L_Elbow","R_Elbow","L_Wrist","R_Wrist","L_Knee","R_Knee"].some(k=>a[k]===shoe && shoe!=="AD795C"))sleeves++;
    shoes.add(a.shoeC);laces.add(a.laceC);soles.add(a.soleC);
  }
  assert.ok(tattoos/5000>0.27 && tattoos/5000<0.33,tattoos);
  assert.ok(sleeves/5000>0.40,sleeves);
  assert.ok(shoes.size>=20&&laces.size>=20&&soles.size>=20);
  const real=api.buildAccessories("AD795C","433029","0","FFFFFF",false)[0];
  assert.ok(!Object.entries(real).some(([k,v])=>/^[LR]_/.test(k)&&v==="433029"));
});
