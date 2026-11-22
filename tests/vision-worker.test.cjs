const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("worker transforms retain location and player export fields", async () => {
  const { default: worker } = await import("../location-worker.js");
  const root = path.join(__dirname,"..");
  const html = fs.readFileSync(path.join(root,"index.html"),"utf8");
  const csv = fs.readFileSync(path.join(root,"data/location-catalog.csv"),"utf8");
  const env = {ASSETS:{fetch:async r=>new URL(r.url).pathname.endsWith(".csv")?new Response(csv):new Response(html)}};
  const transformed = await (await worker.fetch(new Request("https://example.test/"),env)).text();
  for (const text of ["__HOOPLAND_RESOLVE_LOCATION(player)","assignedLocation.loc","isReal: Boolean"])assert.ok(transformed.includes(text),text);
  assert.match(transformed,/STR:\s*\[\s*player\.physical\.STR,\s*player\.physical\.STR/);
  assert.ok(!transformed.includes("__HOOPLAND_SAMPLE_HEADSHOT"));
  const code=transformed.slice(transformed.indexOf("function makeHoopLandPlayer("),transformed.indexOf("function downloadHoopLand()"));
  const exportPlayer=vm.runInNewContext(code+"\nmakeHoopLandPlayer",{
    window:{__HOOPLAND_RESOLVE_LOCATION:()=>({home:"",loc:{x:1,y:2}})},
    randomInteger:()=>1,document:{getElementById:()=>({value:"0"})},makeEmptyStatLine:()=>({})
  });

  await test("location assignment fails closed when the catalog or transform is unavailable", async () => {
    const {default:worker}=await import("../location-worker.js");
    const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
    for (const [page,catalog] of [
      [html,new Response("missing",{status:404})],
      [html,new Response("Country,State,City,X,Y\nUS,,Bad,,\n")],
      [html.replace("function makePlayer(","function missingPlayer("),new Response("Country,State,City,X,Y\nUS,,Good,123,456\n")]
    ]) {
      const env={ASSETS:{fetch:async r=>new URL(r.url).pathname.endsWith(".csv")?catalog:new Response(page)}};
      const response=await worker.fetch(new Request("https://example.test/"),env);
      assert.equal(response.status,503);
    }
    const exportCode=html.slice(html.indexOf("function makeHoopLandPlayer("),html.indexOf("function downloadHoopLand()"));
    const exportPlayer=vm.runInNewContext(exportCode+"\nmakeHoopLandPlayer",{window:{}});
    assert.throws(()=>exportPlayer({appearance:{}},0),/Location catalog is unavailable/);
  });

  await test("real and fictional exported coordinates always come from the supplied catalog", async () => {
    const {default:worker}=await import("../location-worker.js");
    const root=path.join(__dirname,"..");
    const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
    const csv=fs.readFileSync(path.join(root,"data/location-catalog.csv"),"utf8");
    const env={ASSETS:{fetch:async r=>new URL(r.url).pathname.endsWith(".csv")?new Response(csv):new Response(html)}};
    const page=await (await worker.fetch(new Request("https://example.test/"),env)).text();
    const script=page.match(/<script>\nwindow\.__HOOPLAND_LOCATION_RECORDS[\s\S]*?<\/script>/)[0].slice(8,-9);
    const context=vm.createContext({window:{},console:{warn(){}},randomInteger:()=>1,
      document:{getElementById:()=>({value:"0"})},makeEmptyStatLine:()=>({})});
    vm.runInContext(script,context);
    const exportCode=page.slice(page.indexOf("function makeHoopLandPlayer("),page.indexOf("function downloadHoopLand()"));
    const exportPlayer=vm.runInContext(exportCode+"\nmakeHoopLandPlayer",context);
    const player={fn:"Test",ln:"Player",ctry:"US",age:20,ht:78,wt:200,year:1,pos:4,arc:"GOAT",pot:10,regressionAge:32,
      appearance:{skinC:"AD795C",eyeC:"090502",browC:"202020",hair:"0001",hairC:"202020",fHair:"0000",fHairC:"202020",accessories:[]},
      attributes:{},physical:{STR:10,SPD:10,STA:10},tendencies:{}};
    const allowed=new Set(context.window.__HOOPLAND_LOCATION_RECORDS.map(p=>`${p.x},${p.y}`));
    for (const location of [
      {isReal:false,ctry:"US"}, {isReal:false,ctry:"BE"},
      {isReal:true,home:"Boston, MA",homeX:4236,homeY:-7106},
      {isReal:true,home:"Unknown",homeX:1,homeY:2},
      {isReal:true,home:"Unknown",ctry:"BE"}
    ]) {
      for(let i=0;i<20;i++) {
        const {x,y}=exportPlayer({...player,...location},i).loc;
        assert.ok(allowed.has(`${x},${y}`),`${x},${y}`);
      }
    }
    context.window.__HOOPLAND_LOCATION_RECORDS=[];
    assert.throws(()=>exportPlayer(player,0),/Location catalog is unavailable/);
  });
  const player={
    fn:"Test",ln:"Player",ctry:"US",age:20,ht:78,wt:200,year:1,pos:4,arc:"GOAT",pot:10,regressionAge:32,
    appearance:{skinC:"AD795C",eyeC:"090502",browC:"202020",hair:"0001",hairC:"202020",fHair:"0000",fHairC:"202020",accessories:[]},
    attributes:{DRB:[12,20]},physical:{STR:10,SPD:10,STA:10},tendencies:{}
  };
  const exported=exportPlayer(player,0);
  assert.equal(exported.ht,78);
  assert.equal(exported.wt,200);
  assert.equal(exported.arc,"GOAT");
  assert.equal(exported.pot,10);
  assert.equal(exported.pot,player.pot);
  assert.equal(exported.attributes.DRB[1],20);
  assert.deepEqual(Array.from(exported.attributes.STR),[10,10]);
  assert.deepEqual(Array.from(exported.attributes.SPD),[10,10]);
  assert.deepEqual(Array.from(exported.attributes.STM),[10,10]);
  const codes=["LAY","DNK","INS","MID","TPT","FTS","DRB","PAS","ORE","DRE","STL","BLK"];
  player.attributes=Object.fromEntries(codes.map((code,index)=>[code,[index===0?17:2,index<7?20:index===7?6:2]]));
  const ratingCode=html.slice(html.indexOf("function budgetForStars("),html.indexOf("function starText("))+
    html.slice(html.indexOf("function refreshPlayerRatingTotals("),html.indexOf("function applySharedRatings("));
  const refresh=vm.runInNewContext(ratingCode+"\nrefreshPlayerRatingTotals",{
    ATTRS:codes.map(code=>[code,code]),clamp:(value,min,max)=>Math.min(max,Math.max(min,value))
  });
  refresh(player);
  assert.equal(player.currentStars,15*5/144);
  assert.equal(exportPlayer(player,0).pot,9);
  player.attributes.PAS[1]++;
  refresh(player);
  const updated=exportPlayer(player,0);
  assert.equal(updated.pot,10);
  assert.deepEqual(Array.from(updated.attributes.PAS),[2,7]);
});
