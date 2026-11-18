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

test("real-player preparation compares up to four distinct photo descriptions", async () => {
  const {default:worker} = await import("../location-worker.js");
  const csv = fs.readFileSync(path.join(__dirname, "..", "data/location-catalog.csv"),"utf8");
  const env = {ASSETS:{fetch:async r=>new URL(r.url).pathname.endsWith(".csv")?new Response(csv):new Response(html)}};
  const transformed = await (await worker.fetch(new Request("https://example.test/"),env)).text();
  const script=transformed.match(/<script>\nwindow\.__HOOPLAND_LOCATION_RECORDS[\s\S]*?<\/script>/)[0].slice(8,-9);
  const one="https://a.espncdn.com/one.png",two="https://a.espncdn.com/two.png";
  const three="https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Frieda.jpg/600px-Frieda.jpg";
  const duplicate="https://commons.wikimedia.org/wiki/Special:FilePath/Frieda.jpg?width=400";
  const four="https://a.espncdn.com/four.png",five="https://a.espncdn.com/five.png";
  const requested=[];
  Object.assign(context,{
    window:context,URL,URLSearchParams,REAL_PLAYER_APPEARANCE_PROFILES:{},
    normalizeAppearancePlayerName:name=>name.toLowerCase().replace(/[^a-z0-9]/g,""),
    console:{warn(){}},
    document:{
      getElementById:id=>({value:id==="classType"?"freshman":"2026"}),
      createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({})})})
    },
    createImageBitmap:async()=>({width:100,height:100}),
    fetch:async url=>{
      if(String(url).startsWith("/api/hometown"))return Response.json({headshot:one,headshots:[duplicate,four,five]});
      if(String(url).startsWith("/api/describe")){
        const src=new URL(String(url),"https://example.test").searchParams.get("src");
        requested.push(src);
        if(src===two)return Response.json({ok:false,error:"unavailable"});
        return Response.json({ok:true,text:src===one||src===three
          ?"skin: dark 4; hair color: black 2; hairstyle: high-bun"
          :"skin: light 1; hair color: black 2; hairstyle: high-bun"});
      }
      throw new Error("Unexpected request "+url);
    }
  });
  vm.runInContext(script,context);
  context.__HOOPLAND_VISION_SHEET=async()=>new Blob(["sheet"],{type:"image/jpeg"});
  const player={fn:"Awa",ln:"Fam",headshot:one,headshots:[one+"?width=200",two,three]};
  await context.__HOOPLAND_PREPARE_REAL_PLAYERS([player],"1");
  assert.deepEqual(requested,[one,two,three,four,five]);
  assert.equal(player.headshotSample,undefined);
  assert.ok(player.appearanceWarnings.some(w=>w.includes("4 of 5 attempted photos")));
  assert.doesNotMatch(player.lookText,/skin:/);
  assert.match(player.lookText,/hairstyle: high-bun/);
  assert.ok(player.appearanceWarnings.some(w=>w.includes("Photos disagree on skin")));
});

test("a partial appearance profile still fetches and applies photo descriptions", async () => {
  const {default:worker} = await import("../location-worker.js");
  const csv = fs.readFileSync(path.join(__dirname, "..", "data/location-catalog.csv"),"utf8");
  const env = {ASSETS:{fetch:async r=>new URL(r.url).pathname.endsWith(".csv")?new Response(csv):new Response(html)}};
  const transformed = await (await worker.fetch(new Request("https://example.test/"),env)).text();
  const script=transformed.match(/<script>\nwindow\.__HOOPLAND_LOCATION_RECORDS[\s\S]*?<\/script>/)[0].slice(8,-9);
  const c=vm.createContext({
    window:{},URL,URLSearchParams,console:{warn(){}},
    REAL_PLAYER_APPEARANCE_PROFILES:{azzifudd:{hairId:125}},
    REAL_PLAYER_DESCRIPTIONS:{},
    normalizeAppearancePlayerName:name=>name.toLowerCase().replace(/[^a-z0-9]/g,""),
    mergeLookDescriptions:merge,parseLookDescription:parse,
    document:{
      getElementById:()=>({value:"freshman"}),
      createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({})})})
    },
    createImageBitmap:async()=>({width:100,height:100}),
    fetch:async url=>{
      if(String(url).startsWith("/api/hometown"))return Response.json({headshot:"https://a.espncdn.com/azzi.png"});
      if(String(url).startsWith("/api/describe"))return Response.json({ok:true,text:"skin: dark 4; hairstyle: bald"});
      throw new Error("Unexpected request "+url);
    }
  });
  vm.runInContext(script,c);
  c.window.__HOOPLAND_VISION_SHEET=async()=>new Blob(["sheet"],{type:"image/jpeg"});
  const player={fn:"Azzi",ln:"Fudd"};
  await c.window.__HOOPLAND_PREPARE_REAL_PLAYERS([player],"1");
  assert.match(player.lookText,/skin: dark 4/);
  assert.ok(player.appearanceWarnings.some(w=>w.includes("1 of 1 attempted photos")));
  assert.ok(player.appearanceWarnings.some(w=>w.includes("fewer than three")));
});

test("draft photo lookup receives the season and college from the stats profile", async () => {
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

test("photo service failures are reported instead of looking like successful matches", async () => {
  const {default:worker} = await import("../location-worker.js");
  const csv = fs.readFileSync(path.join(__dirname, "..", "data/location-catalog.csv"),"utf8");
  const env = {ASSETS:{fetch:async r=>new URL(r.url).pathname.endsWith(".csv")?new Response(csv):new Response(html)}};
  const transformed = await (await worker.fetch(new Request("https://example.test/"),env)).text();
  const script=transformed.match(/<script>\nwindow\.__HOOPLAND_LOCATION_RECORDS[\s\S]*?<\/script>/)[0].slice(8,-9);
  const c=vm.createContext({
    window:{},URL,URLSearchParams,console:{warn(){}},
    REAL_PLAYER_APPEARANCE_PROFILES:{},REAL_PLAYER_DESCRIPTIONS:{},
    normalizeAppearancePlayerName:name=>name.toLowerCase().replace(/[^a-z0-9]/g,""),
    mergeLookDescriptions:merge,parseLookDescription:parse,
    document:{getElementById:()=>({value:"freshman"})},
    fetch:async url=>String(url).startsWith("/api/hometown")
      ? Response.json({headshot:"https://a.espncdn.com/player.png"})
      : Response.json({ok:false,error:"AI binding missing"})
  });
  vm.runInContext(script,c);
  c.window.__HOOPLAND_VISION_SHEET=async()=>new Blob(["sheet"],{type:"image/jpeg"});
  const player={fn:"Example",ln:"Player"};
  await c.window.__HOOPLAND_PREPARE_REAL_PLAYERS([player],"1");
  assert.equal(player.lookText,"");
  assert.ok(player.appearanceWarnings.some(w=>w.includes("AI binding missing") && w.includes("placeholders")));
});

test("freshman preparation uses verified roster photos and warns when only a name-search photo exists", async () => {
  const {default:worker} = await import("../location-worker.js");
  const csv = fs.readFileSync(path.join(__dirname, "..", "data/location-catalog.csv"),"utf8");
  const env = {ASSETS:{fetch:async r=>new URL(r.url).pathname.endsWith(".csv")?new Response(csv):new Response(html)}};
  const transformed = await (await worker.fetch(new Request("https://example.test/"),env)).text();
  const script=transformed.match(/<script>\nwindow\.__HOOPLAND_LOCATION_RECORDS[\s\S]*?<\/script>/)[0].slice(8,-9);
  const original = global.fetch;
  const verified = "https://a.espncdn.com/i/headshots/womens-college-basketball/players/full/71.png";
  const wrong = "https://a.espncdn.com/wrong-player.png";
  const described = [];
  try {
    global.fetch = async url => {
      const request = new URL(url);
      if (request.pathname.endsWith("/901/roster")) return Response.json({
        team:{id:"901"},season:{year:2026},
        athletes:[{id:"71",displayName:"Verified Recruit",headshot:{href:verified}}]
      });
      if (request.hostname === "www.wikidata.org") return Response.json({search:[]});
      if (request.pathname.includes("/search")) {
        const name = request.searchParams.get("query");
        return Response.json({results:[{id:"72",displayName:name,sport:"basketball"}]});
      }
      if (request.pathname.includes("/athletes/72")) return Response.json({
        athlete:{displayName:"Missing Recruit",headshot:{href:wrong}}
      });
      if (request.pathname.includes("/athletes/71")) return new Response("",{status:404});
      throw new Error("Unexpected request "+url);
    };
    const c=vm.createContext({
      window:{},URL,URLSearchParams,console:{warn(){}},
      REAL_PLAYER_APPEARANCE_PROFILES:{},REAL_PLAYER_DESCRIPTIONS:{},
      normalizeAppearancePlayerName:name=>name.toLowerCase().replace(/[^a-z0-9]/g,""),
      mergeLookDescriptions:merge,parseLookDescription:parse,
      document:{getElementById:()=>({value:"freshman"})},
      fetch:async url=>{
        const request = new URL(String(url),"https://example.test");
        if(request.pathname==="/api/hometown") return worker.fetch(new Request(request),env);
        if(request.pathname==="/api/describe"){
          described.push(request.searchParams.get("src"));
          return Response.json({ok:true,text:"skin: dark 4; hairstyle: high-bun"});
        }
        throw new Error("Unexpected request "+url);
      }
    });
    vm.runInContext(script,c);
    c.window.__HOOPLAND_VISION_SHEET=async()=>new Blob(["sheet"],{type:"image/jpeg"});
    const players=[
      {fn:"Verified",ln:"Recruit",collegeTeamId:"901",recruitYear:2025},
      {fn:"Missing",ln:"Recruit",collegeTeamId:"901",recruitYear:2025}
    ];
    await c.window.__HOOPLAND_PREPARE_REAL_PLAYERS(players,"1");
    assert.deepEqual(described,[verified]);
    assert.match(players[0].lookText,/skin: dark 4/);
    assert.ok(players[0].appearanceWarnings.some(w=>w.includes("fewer than three")));
    assert.ok(players[1].appearanceWarnings.some(w=>w.includes("No photo was found")));
  } finally { global.fetch = original; }
});

test("vision reference sheet draws the photo and actual selector swatches", async () => {
  const {default:worker}=await import("../location-worker.js");
  const csv=fs.readFileSync(path.join(__dirname,"..","data/location-catalog.csv"),"utf8");
  const env={ASSETS:{fetch:async r=>new URL(r.url).pathname.endsWith(".csv")?new Response(csv):new Response(html)}};
  const transformed=await (await worker.fetch(new Request("https://example.test/"),env)).text();
  const script=transformed.match(/<script>\nwindow\.__HOOPLAND_LOCATION_RECORDS[\s\S]*?<\/script>/)[0].slice(8,-9);
  const colors=[],labels=[],photos=[];
  const canvasContext={
    set fillStyle(value){this.color=value;},
    fillRect(){colors.push(this.color);},
    fillText(value){labels.push(value);},
    drawImage(...args){photos.push(args);}
  };
  const c=vm.createContext({
    window:{},URL,URLSearchParams,APPEARANCE_PALETTES:palette,
    colorLum:hex=>[.299,.587,.114].reduce((sum,w,i)=>sum+w*parseInt(hex.slice(i*2,i*2+2),16),0),
    appearanceHairPalette:group=>[...new Set(palette.flatMap(p=>p.hair[group]||[]))].sort((a,b)=>
      [0,2,4].reduce((n,i)=>n+parseInt(b.slice(i,i+2),16)-parseInt(a.slice(i,i+2),16),0)),
    fetch:async()=>new Response(new Uint8Array([1,2,3]),{headers:{"content-type":"image/png"}}),
    createImageBitmap:async()=>({width:200,height:300,close(){}}),
    document:{createElement:()=>({getContext:()=>canvasContext,toBlob:callback=>callback(new Blob(["jpeg"],{type:"image/jpeg"}))})}
  });
  vm.runInContext(script,c);
  const image=await c.window.__HOOPLAND_VISION_SHEET("https://a.espncdn.com/example.png");
  assert.equal(image.type,"image/jpeg");
  assert.equal(photos.length,1);
  for(const group of palette) for(const color of group.skins) assert.ok(colors.includes("#"+color),color);
  assert.ok(labels.includes("L1")&&labels.includes("D6")&&labels.includes("K1"));
});
