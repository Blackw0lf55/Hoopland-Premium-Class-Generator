const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const palettes = html.slice(html.indexOf("const APPEARANCE_PALETTES ="), html.indexOf("const MEN_HAIRS="));
const catalog = html.slice(html.indexOf("const HAIR_CATALOG ="), html.indexOf("function validateHairCatalog()"));
const score = html.slice(html.indexOf("  function hairMatchScore("), html.indexOf("  function findBestHairReference("));
const descriptions = html.slice(html.indexOf("const REAL_PLAYER_DESCRIPTIONS ="), html.indexOf("function appearanceSourceFor("));
const context = vm.createContext({});
const { parse, merge, apply, saved, palette } = vm.runInContext(`
  ${palettes}
  ${catalog}
  ${score}
  function padStyle(n){return String(n).padStart(4,"0");}
  function pick(items){return items[0];}
  function colorLum(hex){const c=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));return .299*c[0]+.587*c[1]+.114*c[2];}
  ${descriptions}
  ({parse:parseLookDescription,merge:mergeLookDescriptions,apply:applyLookDescription,saved:REAL_PLAYER_DESCRIPTIONS,palette:APPEARANCE_PALETTES})
`, context);
const plain = x => JSON.parse(JSON.stringify(x));
const base = () => ({ skinC:"F4D2C3", hairC:"202020", eyeC:"090502", browC:"181818", fHairC:"202020", hair:"0001", fHair:"0000", accessories:[{headAcc:"none",L_Elbow:"F4D2C3"}] });

test("unknown skin and black hair do not infer skin tone or a hairstyle from clean shaven", () => {
  const parsed = parse("skin: unknown; hair color: black 2; hairstyle: unknown; facial hair: clean shaven; accessory: unknown");
  assert.equal(parsed.skin, undefined);
  assert.equal(parsed.skinExact, undefined);
  assert.equal(parsed.hairId, undefined);
  assert.equal(parsed.hairStyle, undefined);
  assert.equal(parsed.accessory, undefined);
  assert.equal(parsed.facialHair, 0);
  assert.equal(apply(base(), "hair color: black 2; hairstyle: unknown", "1").skinC, "F4D2C3");
  const textured = parse("skin: dark 4; hair color: unknown; hairstyle: textured-coils");
  assert.equal(textured.hairExact,undefined);
  assert.equal(textured.hairColor,undefined);
  assert.equal(textured.skinExact.group,"dark");
});

test("user-provided skin tones override estimates without overwriting other features", () => {
  for (const [name, group] of [["awafam","dark"],["laurenbetts","bronze"]]) {
    const estimated = apply(base(), "skin: light 1; hair color: black 2; hairstyle: high-bun", "1");
    const corrected = apply(estimated, saved[name], "1");
    assert.ok(palette.find(p => p.group === group).skins.includes(corrected.skinC), name);
    assert.equal(corrected.hair, estimated.hair);
    assert.equal(corrected.hairC, estimated.hairC);
    assert.equal(corrected.accessories[0].L_Elbow, corrected.skinC);
  }
});

test("skin descriptions use the exact numbered editor palette shade", () => {
  for (const group of palette) {
    group.skins.forEach((skin, index) => {
      const description = `skin: ${group.group} ${index + 1}`;
      assert.equal(apply(base(), description, "1").skinC, skin, description);
      assert.match(merge([description]).text, new RegExp(description));
    });
  }
  assert.equal(parse("skin: bronze 6").skinExact, undefined);
  assert.equal(merge(["skin: bronze 6"]).text, "");
});

test("Awa Thiam is normalized to Awa Fam without altering other names", () => {
  const nameFunctions = html.slice(html.indexOf("  function normalizeAppearancePlayerName("), html.indexOf("  function hairMatchScore("));
  const canonicalize = vm.runInNewContext(`${nameFunctions}\ncanonicalizeRealPlayer`);
  assert.deepEqual(plain(canonicalize({ fn: "Awa", ln: "Thiam" })), { fn: "Awa", ln: "Fam" });
  assert.deepEqual(plain(canonicalize({ fn: "Awa", ln: "Fam Thiam" })), { fn: "Awa", ln: "Fam" });
  assert.deepEqual(plain(canonicalize({ fn: "Awa", ln: "Fam" })), { fn: "Awa", ln: "Fam" });
  assert.deepEqual(plain(canonicalize({ fn: "Other", ln: "Thiam" })), { fn: "Other", ln: "Thiam" });
});

test("photo-derived features override an unverified profile, while missing features use it", () => {
  const helpers = html.slice(html.indexOf("  function findBestHairReference("), html.indexOf("const REAL_PLAYER_DESCRIPTIONS ="));
  const generate = html.slice(html.indexOf("  function generateRealPlayerAppearance("), html.indexOf("const MEN_FACIAL_HAIR="));
  const nameFunctions = html.slice(html.indexOf("  function normalizeAppearancePlayerName("), html.indexOf("  function hairMatchScore("));
  const fn = vm.runInContext(`
    ${nameFunctions}
    ${helpers}
    const REAL_PLAYER_APPEARANCE_PROFILES={azzifudd:{hairId:125,hairC:"202020"}};
    function generateAppearance(){return ${JSON.stringify(base())};}
    function harmonizeFaceColors(a){return a;}
    function getPrimaryAccessoryReference(){return null;}
    ${generate}
    generateRealPlayerAppearance
  `, context);
  const player = {fn:"Azzi",ln:"Fudd",lookText:"skin: dark 4; hairstyle: bald"};
  const result = fn(player,"1");
  assert.equal(result.skinC, palette.find(p => p.group === "dark").skins[3]);
  assert.equal(result.hair,"0000");
  assert.equal(result.accessories[0].L_Elbow,result.skinC);
  assert.equal(fn({fn:"Azzi",ln:"Fudd",lookText:"skin: dark 4"},"1").hair,"0125");
});

test("explicit hair descriptions are not randomly discarded for dark skin or gender", () => {
  const look = apply(base(), "skin: dark 4; hair color: blonde 2; hairstyle: bald", "1");
  assert.equal(look.hair, "0000");
  assert.ok(palette[0].hair.blonde.includes(look.hairC));
  assert.equal(apply(base(), "hairstyle: large-coiled-halo", "0").hair, "0167");
  assert.equal(saved.cooperflagg,undefined);
  assert.equal(saved.oliviamiles,undefined);
  const frieda = apply(base(), saved.friedabuhner, "1");
  assert.equal(frieda.skinC, "F4D2C3");
  assert.equal(frieda.hairC, "D5A07D");
});

test("distinct photo observations produce distinct appearances", () => {
  const first = merge(["skin: dark brown; hair color: black; hairstyle: long braids", "skin: unknown"]);
  const second = merge(["skin: light; hair color: blonde; hairstyle: bald", "skin: unknown"]);
  const a = apply(base(), first.text, "1");
  const b = apply(base(), second.text, "1");
  assert.notEqual(a.skinC, b.skinC);
  assert.notEqual(a.hairC, b.hairC);
  assert.notEqual(a.hair, b.hair);
  assert.ok(first.unconfirmed.includes("skin"));
});

test("multiple photo descriptions use agreement and flag conflicts or missing evidence", () => {
  const a = "skin: dark 4; hair color: black 2; hairstyle: high-bun; accessory: none";
  const b = "skin: dark 3; hair color: black 2; hairstyle: high-bun; accessory: none";
  const result = plain(merge([a,b]));
  assert.match(result.text, /skin: dark 4/);
  assert.match(result.text, /hairstyle: high-bun/);
  assert.deepEqual(result.conflicts, []);
  const disputed = plain(merge([a,"skin: light 1; hair color: blonde 1; hairstyle: long-loose"]));
  assert.ok(disputed.conflicts.includes("skin"));
  assert.ok(disputed.conflicts.includes("hair color"));
  assert.ok(disputed.conflicts.includes("hairstyle"));
  assert.doesNotMatch(disputed.text, /skin:|hair color:|hairstyle:/);
  assert.deepEqual(plain(merge([a,"skin: unknown"])).unconfirmed, ["skin","hair color","hairstyle","accessory"]);
  const partial = merge([a, "skin: unknown; hair color: unknown; hairstyle: unknown"]);
  assert.match(partial.text, /skin: dark 4/);
  assert.match(partial.text, /hairstyle: high-bun/);
  assert.ok(partial.unconfirmed.includes("skin"));
  const named = merge(["skin: dark brown; hair color: black; hairstyle: long braids"]);
  assert.match(named.text, /skin: dark 3/);
  assert.match(named.text, /hair color: black \d/);
  assert.notEqual(apply(base(), named.text, "1").skinC, base().skinC);
  const duplicate = plain(merge(["skin: dark 4; skin: dark 4","skin: light 1"]));
  assert.deepEqual(duplicate.conflicts, ["skin"]);
  const majority = plain(merge([a,b,"skin: light 1; hairstyle: long-loose"]));
  assert.match(majority.text,/skin: dark 4/);
  assert.match(majority.text,/hairstyle: high-bun/);
  assert.deepEqual(plain(merge(["skin: dark 1","skin: dark 5"])).conflicts,["skin"]);
  const annotated = merge(["skin: D4 (dark brown); hair color: K2 (black)"]);
  assert.match(annotated.text,/skin: dark 4/);
  assert.match(annotated.text,/hair color: black 2/);
  assert.equal(merge(["skin: D4 or D3"]).text,"");
});

test("visual swatch codes map to selector colors and neighboring skin groups agree", () => {
  const result=plain(merge(["skin: L6; hair color: K2; hairstyle: long braided ponytail",
    "skin: M1; hair color: K2; hairstyle: long braided ponytail"]));
  assert.match(result.text,/skin: medium 1/);
  assert.match(result.text,/hair color: black 2/);
  assert.match(result.text,/hairstyle:/);
  assert.equal(apply(base(),result.text,"1").skinC,palette[1].skins[0]);
  assert.equal(apply(base(),result.text,"1").hairC,"252525");
  assert.doesNotMatch(merge(["skin: B6; hair color: R6"]).text,/skin:|hair color:/);
});

test("known hair colors survive harmonization for real-player appearances", () => {
  const code=html.slice(html.indexOf("function colorLum("),html.indexOf("function generateAppearance(gender,"));
  const harmonize=vm.runInContext(`${code}\nlet rng=()=>0; harmonizeFaceColors`,context);
  const hair="7A5A40";
  const input={skinC:"835444",hairC:hair,eyeC:"090502"};
  assert.notEqual(harmonize(input).hairC,hair);
  assert.equal(harmonize(input,true).hairC,hair);
});

test("real-player placeholders do not invent tattoos or accessories", () => {
  const code=html.slice(html.indexOf("function buildAccessories("),html.indexOf("let rng = Math.random;"));
  const fn=vm.runInNewContext(`
    const rng=()=>0;
    const shoeColorsEnabled=()=>false;
    const BODY_SEGMENTS=["L_Shoulder"],PRIMARY_ACCESSORIES=[18],SECONDARY_ACCESSORIES=[5],SHOE_COLORS=["FFFFFF"];
    const shuffled=items=>items,randomInteger=()=>1,pick=items=>items[0],padStyle=n=>String(n).padStart(4,"0");
    ${code}
    buildAccessories
  `);
  const real=fn("AD795C","000000","0","FFFFFF",false);
  assert.ok(real.every(item=>item.headAcc==="none" && item.L_Shoulder==="AD795C" && item.L_Shin==="AD795C"));
  const fictional=fn("AD795C","000000","0","FFFFFF");
  assert.notEqual(fictional[0].headAcc,"none");
});

test("real-player preparation ignores image URLs and never requests image services", async () => {
  const {default:worker} = await import("../location-worker.js");
  const csv = fs.readFileSync(path.join(__dirname, "..", "data/location-catalog.csv"),"utf8");
  const env = {ASSETS:{fetch:async r=>new URL(r.url).pathname.endsWith(".csv")?new Response(csv):new Response(html)}};
  const transformed = await (await worker.fetch(new Request("https://example.test/"),env)).text();
  const script=transformed.match(/<script>\nwindow\.__HOOPLAND_LOCATION_RECORDS[\s\S]*?<\/script>/)[0].slice(8,-9);
  const requests=[];
  const c=vm.createContext({
    window:{},URL,URLSearchParams,console:{warn(){}},
    document:{getElementById:id=>({value:id==="classType"?"freshman":"2026"})},
    fetch:async url=>{
      requests.push(String(url));
      if(String(url).startsWith("/api/imported-roster"))return Response.json({ok:true,player:null});
      if(String(url).startsWith("/api/shared-attributes"))return Response.json({ok:true,ratings:[]});
      if(String(url).startsWith("/api/shared-appearance"))return Response.json({ok:true,appearances:[]});
      if(String(url).startsWith("/api/hometown"))return Response.json({headshot:"https://example.test/image.png"});
      throw new Error("Unexpected request "+url);
    }
  });
  vm.runInContext(script,c);
  const player={fn:"Example",ln:"Player",headshot:"https://example.test/image.png"};
  await c.window.__HOOPLAND_PREPARE_REAL_PLAYERS([player],"0");
  assert.ok(requests.some(url=>url.startsWith("/api/hometown")));
  assert.ok(requests.every(url=>!url.includes("/api/headshot")&&!url.includes("/api/describe")));
  assert.equal(player.lookText,undefined);
  assert.match(player.appearanceWarnings[0],/placeholders/);
});

test("real-player preparation loads only the matching roster year and level", async () => {
  const {default:worker}=await import("../location-worker.js");
  const csv=fs.readFileSync(path.join(__dirname,"..","data/location-catalog.csv"),"utf8");
  const env={ASSETS:{fetch:async r=>new URL(r.url).pathname.endsWith(".csv")?new Response(csv):new Response(html)}};
  const page=await (await worker.fetch(new Request("https://example.test/"),env)).text();
  const script=page.match(/<script>\nwindow\.__HOOPLAND_LOCATION_RECORDS[\s\S]*?<\/script>/)[0].slice(8,-9);
  const lookups=[];
  const c=vm.createContext({
    window:{},URL,URLSearchParams,console:{warn(){}},
    document:{getElementById:id=>({value:id==="classType"?"freshman":"1995"})},
    fetch:async url=>{
      if(String(url).startsWith("/api/imported-roster")){
        lookups.push(new URL(String(url),"https://example.test").searchParams);
        return Response.json({ok:true,player:{attributes:{LAY:[12,16]},
          bio:{height:75,weight:190,position:2,age:18,jersey:5,country:"US"},
          tendencies:{pass:2}}});
      }
      if(String(url).startsWith("/api/shared-attributes"))return Response.json({ok:true,ratings:[]});
      if(String(url).startsWith("/api/shared-appearance"))return Response.json({ok:true,appearances:[]});
      if(String(url).startsWith("/api/hometown"))return Response.json({});
      throw new Error("Unexpected request "+url);
    }
  });
  vm.runInContext(script,c);
  const p={fn:"Example",ln:"Player"};
  await c.window.__HOOPLAND_PREPARE_REAL_PLAYERS([p],"0");
  assert.equal(lookups[0].get("type"),"college");
  assert.equal(lookups[0].get("year"),"1995");
  assert.equal(p.bioPosition,"SG");
  assert.equal(p.height,75);
  assert.equal(p.importedAge,18);
  assert.deepEqual(p.importedRatings,{LAY:[12,16]});
  assert.equal(p.importedTendencies.pass,2);
});

test("draft hometown lookup receives the season and college from the stats profile", async () => {
  const {default:worker} = await import("../location-worker.js");
  const csv = fs.readFileSync(path.join(__dirname, "..", "data/location-catalog.csv"),"utf8");
  const env = {ASSETS:{fetch:async r=>new URL(r.url).pathname.endsWith(".csv")?new Response(csv):new Response(html)}};
  const transformed = await (await worker.fetch(new Request("https://example.test/"),env)).text();
  const script=transformed.match(/<script>\nwindow\.__HOOPLAND_LOCATION_RECORDS[\s\S]*?<\/script>/)[0].slice(8,-9);
  const lookups=[];
  const c=vm.createContext({
    window:{},URL,URLSearchParams,console:{warn(){}},
    REAL_PLAYER_APPEARANCE_PROFILES:{},REAL_PLAYER_DESCRIPTIONS:{},
    normalizeAppearancePlayerName:name=>name.toLowerCase().replace(/[^a-z0-9]/g,""),
    mergeLookDescriptions:merge,parseLookDescription:parse,
    prepareProfessionalPotential:async()=>{},
    document:{getElementById:id=>({value:id==="classType"?"draft":"2026"})},
    fetch:async url=>{
      if(String(url).startsWith("/api/stats"))return Response.json({ok:true,players:{
        "Laura Ziegler":{team:"Louisville Cardinals"},"Laila Phelia":{team:"Syracuse Orange"}
      }});
      if(String(url).startsWith("/api/hometown")){
        lookups.push(new URL(String(url),"https://example.test").searchParams);
        return Response.json({headshots:[]});
      }
      throw new Error("Unexpected request "+url);
    }
  });
  vm.runInContext(script,c);
  await c.window.__HOOPLAND_PREPARE_REAL_PLAYERS([
    {fn:"Laura",ln:"Ziegler"},{fn:"Laila",ln:"Phelia"}
  ],"1");
  assert.deepEqual(lookups.map(p=>[p.get("name"),p.get("college"),p.get("draftYear")]),[
    ["Laura Ziegler","Louisville Cardinals","2026"],["Laila Phelia","Syracuse Orange","2026"]
  ]);
});

test("community looks bypass photo inference and ambiguous same-name players do not share edits", async () => {
  const {default:worker} = await import("../location-worker.js");
  const csv = fs.readFileSync(path.join(__dirname, "..", "data/location-catalog.csv"),"utf8");
  const env = {ASSETS:{fetch:async r=>new URL(r.url).pathname.endsWith(".csv")?new Response(csv):new Response(html)}};
  const transformed = await (await worker.fetch(new Request("https://example.test/"),env)).text();
  const script=transformed.match(/<script>\nwindow\.__HOOPLAND_LOCATION_RECORDS[\s\S]*?<\/script>/)[0].slice(8,-9);
  const look={skinC:"835444",hairC:"202020",hair:"0001",fHair:"0016"};
  const requests=[];
  const c=vm.createContext({
    window:{},URL,URLSearchParams,console:{warn(){}},
    REAL_PLAYER_APPEARANCE_PROFILES:{},REAL_PLAYER_DESCRIPTIONS:{},
    normalizeAppearancePlayerName:name=>name.toLowerCase().replace(/[^a-z0-9]/g,""),
    mergeLookDescriptions:merge,parseLookDescription:parse,validSharedAppearance:()=>true,combineSharedAppearances:items=>items[0],
    prepareProfessionalPotential:async()=>{},
    document:{getElementById:id=>({value:id==="classType"?"draft":"2026"})},
    fetch:async url=>{
      requests.push(String(url));
      if(String(url).startsWith("/api/stats"))return Response.json({ok:true,players:{}});
      if(String(url).startsWith("/api/shared-appearance"))return Response.json({ok:true,appearances:[look]});
      if(String(url).startsWith("/api/hometown"))return Response.json({headshots:[]});
      throw new Error("Unexpected request "+url);
    }
  });
  vm.runInContext(script,c);
  const players=[{fn:"AJ",ln:"Dynasty"},{fn:"Same",ln:"Name"},{fn:"Same",ln:"Name"}];
  await c.window.__HOOPLAND_PREPARE_REAL_PLAYERS(players,"0");
  assert.deepEqual(players[0].sharedAppearance,look);
  assert.equal(players[0].sharedAppearanceIdentity.year,"2026");
  assert.match(players[0].appearanceWarnings[0],/community-approved/);
  assert.equal(players[1].sharedAppearanceIdentity,undefined);
  assert.equal(requests.filter(url=>url.startsWith("/api/shared-appearance")).length,1);
  assert.ok(!requests.some(url=>url.startsWith("/api/describe")));
});

test("imported baselines are loaded for future classes alongside approved edits", async () => {
  const {default:worker}=await import("../location-worker.js");
  const csv=fs.readFileSync(path.join(__dirname,"..","data/location-catalog.csv"),"utf8");
  const env={ASSETS:{fetch:async r=>new URL(r.url).pathname.endsWith(".csv")?new Response(csv):new Response(html)}};
  const page=await (await worker.fetch(new Request("https://example.test/"),env)).text();
  const script=page.match(/<script>\nwindow\.__HOOPLAND_LOCATION_RECORDS[\s\S]*?<\/script>/)[0].slice(8,-9);
  const look={skinC:"123456",hairC:"123456",hair:"0001",fHair:"0016"};
  const c=vm.createContext({
    window:{},URL,URLSearchParams,console:{warn(){}},
    validImportedBaseline:()=>true,validSharedAppearance:()=>true,combineSharedAppearances:items=>items[0],
    prepareProfessionalPotential:async()=>{},
    document:{getElementById:id=>({value:id==="classType"?"draft":"2030"})},
    fetch:async url=>{
      if(String(url).startsWith("/api/stats"))return Response.json({ok:true,players:{}});
      if(String(url).startsWith("/api/shared-appearance"))return Response.json({ok:true,baseline:{appearance:look},appearances:[{hair:"0008"}]});
      if(String(url).startsWith("/api/hometown"))return Response.json({headshots:[]});
      throw new Error("Unexpected request "+url);
    }
  });
  vm.runInContext(script,c);
  const p={fn:"Example",ln:"Imported"};
  await c.window.__HOOPLAND_PREPARE_REAL_PLAYERS([p],"0");
  assert.deepEqual(p.importedBaseline,look);
  assert.equal(p.sharedAppearance.hair,"0008");
  assert.match(p.appearanceWarnings[0],/imported appearance baseline/);
  assert.match(p.appearanceWarnings[1],/edits override/);
});
