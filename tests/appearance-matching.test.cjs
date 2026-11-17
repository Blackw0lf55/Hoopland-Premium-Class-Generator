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

test("a partial hair profile retains photo-derived skin and curated hair", () => {
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
  assert.equal(result.hair,"0125");
  assert.equal(result.accessories[0].L_Elbow,result.skinC);
});

test("explicit hair descriptions are not randomly discarded for dark skin or gender", () => {
  const look = apply(base(), "skin: dark 4; hair color: blonde 2; hairstyle: bald", "1");
  assert.equal(look.hair, "0000");
  assert.ok(palette[0].hair.blonde.includes(look.hairC));
  assert.equal(apply(base(), "hairstyle: large-coiled-halo", "0").hair, "0167");
  assert.equal(parse(saved.cooperflagg).hairColor.group,"blonde");
  assert.equal(parse(saved.oliviamiles).accessory,6);
  const frieda = apply(base(), saved.friedabuhner, "1");
  assert.equal(frieda.skinC, "F4D2C3");
  assert.equal(frieda.hairC, "D5A07D");
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
  const duplicate = plain(merge(["skin: dark 4; skin: dark 4","skin: light 1"]));
  assert.deepEqual(duplicate.conflicts, ["skin"]);
  const majority = plain(merge([a,b,"skin: light 1; hairstyle: long-loose"]));
  assert.match(majority.text,/skin: dark 4/);
  assert.match(majority.text,/hairstyle: high-bun/);
  assert.deepEqual(plain(merge(["skin: dark 1","skin: dark 5"])).conflicts,["skin"]);
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
  const player={fn:"Azzi",ln:"Fudd"};
  await c.window.__HOOPLAND_PREPARE_REAL_PLAYERS([player],"1");
  assert.match(player.lookText,/skin: dark 4/);
  assert.ok(player.appearanceWarnings.some(w=>w.includes("1 of 1 attempted photos")));
  assert.ok(player.appearanceWarnings.some(w=>w.includes("fewer than three")));
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
