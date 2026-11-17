import existingWorker from "./worker.js";
import { handleClassData, loadEspnDraftPhotos, attachEspnDraftPhotos } from "./class-sources.js";
import { wikidataProfile, wikidataPhotos } from "./enrich.js";
import { handleStats } from "./college-stats.js";

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function parseCsvRow(line) {
  const fields = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }

  fields.push(value.trim());
  return fields;
}

function readValidLocations(csv) {
  return csv
    .split(/\r?\n/)
    .slice(1)
    .filter(line => line.trim())
    .map(parseCsvRow)
    .filter(row => row.length >= 5)
    .map(row => ({
      country: row[0] || "United States",
      state: row[1] || "",
      city: row.slice(2, -2).join(", ").trim(),
      x: Number(row[row.length - 2]),
      y: Number(row[row.length - 1])
    }))
    .filter(location => Number.isInteger(location.x) && Number.isInteger(location.y));
}


const US_STATES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming"
};

const COUNTRY_CODES = {
  USA: "US", US: "US", CAN: "CA", AUS: "AU", FRA: "FR", GBR: "GB", ESP: "ES", GER: "DE",
  DEU: "DE", SRB: "RS", BEL: "BE", NGA: "NG", BRA: "BR", ITA: "IT", TUR: "TR", JPN: "JP",
  CHN: "CN", ARG: "AR", MEX: "MX", NZL: "NZ", SWE: "SE", FIN: "FI", LTU: "LT", GRE: "GR"
};

const ESPN_LEAGUES = {
  women: ["womens-college-basketball", "wnba"],
  men: ["mens-college-basketball", "nba"]
};

const hometownCache = new Map();

async function fetchJSON(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) return null;
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

async function findAthlete(name, gender, debug) {
  const wanted = normalizeName(name);
  const leagues = ESPN_LEAGUES[gender] || ESPN_LEAGUES.men;
  const query = encodeURIComponent(name);
  const searchURLs = [
    "https://site.web.api.espn.com/apis/common/v3/search?limit=10&type=player&query=" + query,
    "https://site.api.espn.com/apis/common/v3/search?limit=10&type=player&query=" + query,
    "https://site.web.api.espn.com/apis/search/v2?limit=10&query=" + query
  ];

  const found = [];
  for (const url of searchURLs) {
    const search = await fetchJSON(url);
    if (!search) {
      debug.push("search failed");
      continue;
    }
    const flat = [];
    const walk = node => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === "object") {
        if (node.id && (node.displayName || node.name)) flat.push(node);
        Object.values(node).forEach(value => {
          if (value && typeof value === "object") walk(value);
        });
      }
    };
    walk(search);
    flat
      .filter(item => normalizeName(item.displayName || item.name) === wanted)
      .filter(item => !item.sport || String(item.sport).toLowerCase().includes("basketball"))
      .forEach(item => found.push(String(item.id)));
    if (found.length) break;
  }

  const ids = [...new Set(found)];
  if (!ids.length) debug.push("no ESPN match");
  let fallback = null;
  for (const id of ids) {
    for (const league of leagues) {
      const data = await fetchJSON(
        "https://site.web.api.espn.com/apis/common/v3/sports/basketball/" + league + "/athletes/" + id
      );
      const athlete = data && (data.athlete || data);
      if (!athlete) continue;
      if (normalizeName(athlete.displayName || athlete.fullName || athlete.name) !== wanted) continue;
      const headshot = (athlete.headshot && athlete.headshot.href) || "";
      const place = athlete.birthPlace && athlete.birthPlace.city ? athlete.birthPlace : null;
      if (place) return { place, headshot };
      if (headshot && !fallback) fallback = { place: null, headshot };
    }
    debug.push("no birthPlace for " + id);
  }
  return fallback;
}

async function geocode(city, state, countryCode) {
  const data = await fetchJSON(
    "https://geocoding-api.open-meteo.com/v1/search?count=20&language=en&format=json&name=" +
      encodeURIComponent(city)
  );
  const results = (data && data.results) || [];
  const sameCountry = countryCode
    ? results.filter(result => result.country_code === countryCode)
    : results;
  const pool = sameCountry.length ? sameCountry : results;
  const stateMatch = state
    ? pool.find(result => normalizeName(result.admin1) === normalizeName(state))
    : null;
  const best = stateMatch || pool[0];
  return best ? { lat: best.latitude, lon: best.longitude, countryCode: best.country_code } : null;
}

async function resolveHometown(name, gender, countryHint) {
  const debug = [];
  const athlete = await findAthlete(name, gender, debug);
  const wikiFallback = async headshot => {
    try {
      const wiki = await wikidataProfile(name);
      if (!wiki) return { headshot, debug };
      return {
        home: wiki.home || undefined,
        headshot,
        x: Number.isFinite(wiki.lat) ? Math.round(wiki.lat * 100) : undefined,
        y: Number.isFinite(wiki.lon) ? Math.round(wiki.lon * 100) : undefined,
        countryName: wiki.country === "United States of America" ? "United States" : undefined,
        debug: ["wikidata"]
      };
    } catch (error) {
      return { headshot, debug: debug.concat(String(error)) };
    }
  };
  if (!athlete) return wikiFallback();
  const place = athlete.place;
  const headshot = athlete.headshot || undefined;
  if (!place) return wikiFallback(headshot);

  const rawCountry = String(place.country || place.countryAbbreviation || countryHint || "").trim();
  const countryCode = COUNTRY_CODES[rawCountry.toUpperCase()] ||
    (rawCountry.length === 2 ? rawCountry.toUpperCase() : "") ||
    COUNTRY_CODES[String(countryHint || "").toUpperCase()] || "";
  const isUS = countryCode === "US";
  const stateName = isUS
    ? US_STATES[String(place.state || "").toUpperCase()] || place.state || ""
    : place.state || "";

  const home = [place.city, isUS ? stateName : rawCountry].filter(Boolean).join(", ");
  const point = await geocode(place.city, isUS ? stateName : "", countryCode);
  if (!point) {
    const wiki = await wikiFallback(headshot);
    return wiki.x !== undefined ? wiki : { home, headshot, debug: ["geocode failed"] };
  }

  return {
    home,
    headshot,
    x: Math.round(point.lat * 100),
    y: Math.round(point.lon * 100),
    countryName: isUS ? "United States" : undefined
  };
}

async function handleHometown(request) {
  const params = new URL(request.url).searchParams;
  const name = (params.get("name") || "").trim();
  const gender = params.get("gender") === "women" ? "women" : "men";
  if (!name) return Response.json({});

  const key = gender + ":" + normalizeName(name);
  if (!hometownCache.has(key)) {
    hometownCache.set(key, (async () => {
      const [hometown, photos] = await Promise.allSettled([
        resolveHometown(name, gender, params.get("ctry")),
        wikidataPhotos(name)
      ]);
      if (hometown.status === "rejected") console.warn("Hometown lookup failed", name, hometown.reason);
      if (photos.status === "rejected") console.warn("Wikimedia photo lookup failed", name, photos.reason);
      return {
        ...(hometown.status === "fulfilled" ? hometown.value : {}),
        headshots: photos.status === "fulfilled" ? photos.value : []
      };
    })());
  }
  const result = await hometownCache.get(key);
  if (!result.home && !result.headshot && !result.headshots.length) hometownCache.delete(key);
  return Response.json(result, { headers: { "cache-control": "public, max-age=86400" } });
}

const HEADSHOT_HOSTS = ["a.espncdn.com", "cdn.nba.com", "commons.wikimedia.org", "upload.wikimedia.org"];
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const VISION_PROMPT = "Describe only the visible features of the single primary basketball player. Use unknown if obscured or unsure; never infer skin color from race. Match the face's actual visible skin color to the nearest palette entry below, not the everyday meaning of the group name. The six-digit values are RGB hex colors, listed in exact shade order: light 1-6: F4D2C3, EEBAA9, E7B099, D9A388, CD9D7E, C69479; medium 1-6: BF8C6B, B98360, AD795C, A07053, 99694F, 8C5D4B; bronze 1-5: 835444, 7A4D3D, 734937, 6B4232, 633D2F; dark 1-6: 5A392B, 533329, 4B2D23, 44291D, 3A231A, 301D15. Output exactly these semicolon-separated fields: skin: <light|medium|bronze|dark> <valid shade number> or unknown; hair color: <blonde|brunette|red|black> <1-5> or unknown; hairstyle: <one of angular-crown, asymmetric-medium, braided-top-knot, broad-coiled-crop, buzz-cut, center-hanging-locs, clean-close-crop, compact-coils, curly-side-tail, defined-short-coils, dense-messy, dense-rounded-locs, double-buns, face-framing-locs, fluffy-rounded, gentle-side-part, hanging-locs, high-braided-ponytail, high-bun, large-coiled-halo, large-curly-halo, large-full-coils, loc-bob, long-loose, long-ponytail, long-side-braids, messy-rounded, narrow-flat-top, neat-raised-crop, raised-front-crop, rounded-braids, rounded-crop, rounded-short-locs, side-combed-front, side-parted-bob, smooth-side-part, sparse-top, tall-flat-top, tapered-top, textured-buzz, textured-coils, vertical-textured-top, wavy-side-crop, wide-rounded-crop, bald, unknown>; facial hair: <clean shaven|chin patch|mustache|goatee|short beard|full beard|long beard|unknown>; accessory: <none|headband|wide headband|goggles|glasses|bandana|visor|cap|unknown>.";

async function runVision(env, dataUrl) {
  const input = { messages: [{ role: "user", content: VISION_PROMPT }], image: dataUrl, max_tokens: 160 };
  try {
    return await env.AI.run(VISION_MODEL, input);
  } catch (error) {
    if (!/5016|agree|license/i.test(String(error && error.message))) throw error;
    await env.AI.run(VISION_MODEL, { prompt: "agree" });
    return await env.AI.run(VISION_MODEL, input);
  }
}

async function handleDescribe(request, env, ctx) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (!env.AI) return json({ ok: false, error: "AI binding missing" });
  const source = new URL(request.url).searchParams.get("src") || "";
  let target;
  try {
    target = new URL(source);
  } catch (error) {
    return json({ ok: false, error: "bad src" }, 400);
  }
  if (target.protocol !== "https:" || !HEADSHOT_HOSTS.includes(target.hostname)) return json({ ok: false, error: "forbidden" }, 403);
  const cache = caches.default;
  const cacheKey = new Request("https://describe.local/?version=3&src=" + encodeURIComponent(target.toString()));
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  try {
    const image = await fetch(target.toString());
    if (!image.ok) return json({ ok: false, error: "image " + image.status });
    const bytes = new Uint8Array(await image.arrayBuffer());
    if (bytes.length > 1500000) return json({ ok: false, error: "image too large" });
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    const type = (image.headers.get("content-type") || "image/png").split(";")[0];
    const result = await runVision(env, "data:" + type + ";base64," + btoa(binary));
    const text = String((result && (result.response || result.description)) || "").toLowerCase().replace(/[^a-z0-9,;: -]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!text) return json({ ok: false, error: "empty" });
    const response = new Response(JSON.stringify({ ok: true, text }), { headers: { "content-type": "application/json", "cache-control": "public, max-age=2592000" } });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    return json({ ok: false, error: String(error && error.message || error) });
  }
}

async function handleHeadshot(request) {
  const source = new URL(request.url).searchParams.get("src") || "";
  let target;
  try {
    target = new URL(source);
  } catch (error) {
    return new Response("Bad request", { status: 400 });
  }
  if (target.protocol !== "https:" || !HEADSHOT_HOSTS.includes(target.hostname)) {
    return new Response("Forbidden", { status: 403 });
  }
  const upstream = await fetch(target.toString());
  if (!upstream.ok) return new Response("Not found", { status: 404 });
  return new Response(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") || "image/png",
      "cache-control": "public, max-age=604800"
    }
  });
}

function replaceOnce(source, pattern, replacement) {
  if (!pattern.test(source)) return null;
  return source.replace(pattern, replacement);
}

function transformGenerator(html) {
  const makePlayerStart = html.indexOf("function makePlayer(");
  const exportStart = html.indexOf("function makeHoopLandPlayer(");
  if (makePlayerStart < 0 || exportStart < 0) return null;

  const generateClassStart = html.indexOf("async function generateClass(", makePlayerStart);
  if (generateClassStart < 0 || generateClassStart > exportStart) return null;

  let makePlayerCode = html.slice(makePlayerStart, generateClassStart);
  const originalHometown = /const hometown\s*=\s*pick\(namePool\.hometowns\);/;
  makePlayerCode = replaceOnce(
    makePlayerCode,
    originalHometown,
    'const hometown = sourcePlayer ? window.__HOOPLAND_REAL_HOMETOWN(sourcePlayer) : "";'
  );
  if (!makePlayerCode) return null;

  const playerObjectStart = /const player\s*=\s*\{/;
  makePlayerCode = replaceOnce(
    makePlayerCode,
    playerObjectStart,
    "const player = {\n    isReal: Boolean(sourcePlayer),\n    homeX: sourcePlayer ? sourcePlayer.homeX : undefined,\n    homeY: sourcePlayer ? sourcePlayer.homeY : undefined,"
  );
  if (!makePlayerCode) return null;

  let generateCode = html.slice(generateClassStart, exportStart);
  generateCode = replaceOnce(
    generateCode,
    /(realPlayers\s*=\s*data\.players\.slice\(\s*0\s*,\s*classSize\s*\);)/,
    "$1\n      await window.__HOOPLAND_PREPARE_REAL_PLAYERS(realPlayers, gender);"
  );
  if (!generateCode) return null;

  let exportCode = html.slice(exportStart);
  const exportHeader = /(function makeHoopLandPlayer\(\s*player\s*,\s*index\s*\)\s*\{\s*)return\s*\{/;
  exportCode = replaceOnce(
    exportCode,
    exportHeader,
    "$1const assignedLocation = window.__HOOPLAND_RESOLVE_LOCATION(player);\n  return {"
  );
  if (!exportCode) return null;

  exportCode = replaceOnce(exportCode, /home:\s*player\.home\s*,/, "home: assignedLocation.home,");
  if (!exportCode) return null;
  exportCode = replaceOnce(exportCode, /loc:\s*\{\s*x:\s*0\s*,\s*y:\s*0\s*\}\s*,/, "loc: assignedLocation.loc,");
  if (!exportCode) return null;

  exportCode = exportCode
    .replace(/(\bSTR\s*:\s*)\[\s*player\.physical\.STR\s*,\s*player\.physical\.STR\s*\]/, "$1[0, 0]")
    .replace(/(\bSPD\s*:\s*)\[\s*player\.physical\.SPD\s*,\s*player\.physical\.SPD\s*\]/, "$1[0, 0]")
    .replace(/(\bSTM\s*:\s*)\[\s*player\.physical\.STA\s*,\s*player\.physical\.STA\s*\]/, "$1[0, 0]");

  return html.slice(0, makePlayerStart) + makePlayerCode + generateCode + exportCode;
}

function buildLocationScript(locations) {
  const realPlayerHometowns = {
    azzifudd: {
      home: "Arlington, Virginia",
      country: "United States",
      // Arlington, VA in the catalog's integer coordinate scale (lat/lon × 100).
      target: { x: 3888, y: -7711 }
    },
    oliviamiles: {
      home: "New Jersey",
      country: "United States",
      // Phillipsburg, NJ in the catalog's integer coordinate scale (lat/lon × 100).
      target: { x: 4069, y: -7519 }
    }
  };

  return `<script>
window.__HOOPLAND_LOCATION_RECORDS=${JSON.stringify(locations)};
window.__HOOPLAND_REAL_PLAYER_HOMETOWNS=${JSON.stringify(realPlayerHometowns)};
window.__HOOPLAND_NORMALIZE_LOCATION_NAME=${normalizeName.toString()};
window.__HOOPLAND_REAL_HOMETOWN=function(sourcePlayer){
  const fullName=[sourcePlayer&&sourcePlayer.fn,sourcePlayer&&sourcePlayer.ln].filter(Boolean).join(" ");
  const known=window.__HOOPLAND_REAL_PLAYER_HOMETOWNS[window.__HOOPLAND_NORMALIZE_LOCATION_NAME(fullName)];
  if(known&&known.home)return known.home;
  return String(sourcePlayer&&(sourcePlayer.hometown||sourcePlayer.home)||"").trim();
};
window.__HOOPLAND_PREPARE_REAL_PLAYERS=async function(players,gender){
  try{
    const type=document.getElementById("classType").value;
    const year=Number(document.getElementById("draftYear").value);
    if(type==="draft"&&year>=2008){
      const names=players.map(p=>[p.fn,p.ln].filter(Boolean).join(" "));
      const res=await fetch("/api/stats?gender="+(gender==="1"?"women":"men")+"&year="+year+"&names="+encodeURIComponent(names.join("|")));
      const d=res.ok?await res.json():null;
      if(d&&d.ok){
        players.forEach((p,i)=>{if(d.players[names[i]])p.bart=d.players[names[i]];});
      }else console.warn("College stats unavailable",d&&d.error);
    }
  }catch(e){console.warn("College stats lookup failed",e);}
  const queue=players.slice();
  const worker=async()=>{
    while(queue.length){
      const p=queue.shift();
      let d=null;
      try{
        const q=new URLSearchParams({name:[p.fn,p.ln].filter(Boolean).join(" "),gender:gender==="1"?"women":"men",ctry:String(p.ctry||p.country||""),v:"2"});
        const res=await fetch("/api/hometown?"+q);
        d=res.ok?await res.json():null;
      }catch(e){console.warn('Hometown and photo lookup failed for',[p.fn,p.ln].join(' '),e);}
      if(d){
        if(d.home&&!window.__HOOPLAND_REAL_HOMETOWN(p)){p.hometown=d.home;}
        if(Number.isFinite(d.x)&&Number.isFinite(d.y)){p.homeX=d.x;p.homeY=d.y;}
        if(d.countryName)p.homeCountry=d.countryName;
        if(!d.home)console.warn('Hometown lookup failed for',[p.fn,p.ln].join(' '),d.debug);
      }
      const extraShots=Array.isArray(p.headshots)?p.headshots:[];
      const seenShots=new Set();
      const discoveredShots=d&&Array.isArray(d.headshots)?d.headshots:[];
      const shots=[p.headshot,...extraShots,d&&d.headshot,...discoveredShots].filter(url=>{
        if(typeof url!=="string"||!url)return false;
        try{
          const parsed=new URL(url);
          let key=parsed.origin+parsed.pathname;
          if(parsed.hostname==="commons.wikimedia.org"||parsed.hostname==="upload.wikimedia.org"){
            const parts=parsed.pathname.split("/");
            const filename=parsed.pathname.includes("/thumb/")?parts[parts.length-2]:parts[parts.length-1];
            key="commons:"+decodeURIComponent(filename).replace(/ /g,"_");
          }
          if(seenShots.has(key))return false;
          seenShots.add(key);
          return true;
        }catch(e){console.warn('Invalid headshot URL for',[p.fn,p.ln].join(' '),e);return false;}
      }).slice(0,8);
      if(shots.length){
        const descriptions=[];
        let attempted=0;
        for(const shot of shots){
          if(descriptions.length===4)break;
          attempted++;
          try{
            const r=await fetch("/api/describe?src="+encodeURIComponent(shot));
            const j=r.ok?await r.json():null;
            if(j&&j.ok&&j.text)descriptions.push(j.text);
            else console.warn('Headshot description unavailable for',[p.fn,p.ln].join(' '),j&&j.error||r.status);
          }catch(e){console.warn('Headshot description failed for',[p.fn,p.ln].join(' '),e);}
        }
        const combined=mergeLookDescriptions(descriptions);
        p.lookText=combined.text;
        p.appearanceWarnings=[descriptions.length+' of '+attempted+' attempted photos described'+(descriptions.length<3?'; fewer than three photos, so please review the match.':'.')];
        if(combined.conflicts.length){
          p.appearanceWarnings.push('Photos disagree on '+combined.conflicts.join(', ')+'; please review those features.');
        }
        if(combined.unconfirmed.length){
          p.appearanceWarnings.push('Only one photo identified '+combined.unconfirmed.join(', ')+'; those features need review.');
        }
        if(descriptions.length<2){
          if(!descriptions.length)p.appearanceWarnings.push('Photo descriptions unavailable; unsaved features are placeholders.');
        }
        const parsed=parseLookDescription(combined.text);
        const saved=REAL_PLAYER_DESCRIPTIONS[normalizeAppearancePlayerName([p.fn,p.ln].filter(Boolean).join(" "))]||"";
        const savedLook=parseLookDescription(saved);
        if(descriptions.length&&!parsed.skinExact&&!savedLook.skinExact&&savedLook.skin===undefined){
          p.appearanceWarnings.push('Skin tone could not be confirmed from the photo descriptions.');
        }
        if(descriptions.length&&!parsed.hairExact&&!parsed.hairColor&&!savedLook.hairExact&&!savedLook.hairColor){
          p.appearanceWarnings.push('Hair color was not confirmed; the color may be an estimate or placeholder.');
        }
        if(parsed.hairId===undefined&&!parsed.hairStyle&&savedLook.hairId===undefined&&!savedLook.hairStyle){
          p.appearanceWarnings.push('Hair style was not identified and is a placeholder.');
        }
        if(combined.conflicts.includes('skin')||combined.unconfirmed.includes('skin')){
          p.appearanceWarnings.push('No photo skin tone was selected; check the saved tone or placeholder.');
        }
      }else{
        const key=normalizeAppearancePlayerName([p.fn,p.ln].filter(Boolean).join(" "));
        const saved=parseLookDescription(REAL_PLAYER_DESCRIPTIONS[key]||"");
        const profile=REAL_PLAYER_APPEARANCE_PROFILES[key];
        p.appearanceWarnings=[saved.skinExact||saved.skin!==undefined||(profile&&profile.skinC)
          ? 'No photo was found in the configured sources; features not covered by the saved profile are placeholders.'
          : 'No photo was found in the configured sources; skin tone and other unsaved features are placeholders.'];
      }
    }
  };
  await Promise.all(Array.from({length:Math.min(6,queue.length)},worker));
};
window.__HOOPLAND_RESOLVE_LOCATION=function(player){
  const records=window.__HOOPLAND_LOCATION_RECORDS||[];
  const normalize=window.__HOOPLAND_NORMALIZE_LOCATION_NAME;
  if(!player||!player.isReal){
    if(!records.length)return {home:"",loc:{x:0,y:0}};
    const fictionalLocation=records[Math.floor(Math.random()*records.length)];
    return {home:"",loc:{x:fictionalLocation.x,y:fictionalLocation.y}};
  }

  const fullName=[player.fn,player.ln].filter(Boolean).join(" ");
  const known=window.__HOOPLAND_REAL_PLAYER_HOMETOWNS[normalize(fullName)];
  const home=known&&known.home?known.home:String(player.home||"").trim();
  const countryNames={US:"United States",CA:"Canada",AU:"Australia",FR:"France",UK:"United Kingdom",GB:"United Kingdom",DE:"Germany",ES:"Spain",RS:"Serbia",BE:"Belgium"};
  const country=(known&&known.country)||player.homeCountry||countryNames[String(player.ctry||"").toUpperCase()]||String(player.ctry||"");
  let candidates=records.filter(record=>normalize(record.country)===normalize(country));
  if(!candidates.length)candidates=records;

  let target=known&&known.target?{x:Math.round(known.target.x),y:Math.round(known.target.y)}:null;
  if(!target&&player.homeX!=null&&player.homeY!=null&&Number.isFinite(Number(player.homeX))&&Number.isFinite(Number(player.homeY))){
    target={x:Math.round(Number(player.homeX)),y:Math.round(Number(player.homeY))};
  }

  if(target&&candidates.length){
    let nearest=candidates[0];
    let minimumDistance=Infinity;
    for(const record of candidates){
      const dx=record.x-target.x;
      const dy=record.y-target.y;
      const distance=dx*dx+dy*dy;
      if(distance<minimumDistance){nearest=record;minimumDistance=distance;}
    }
    return {home,loc:{x:nearest.x,y:nearest.y}};
  }

  const hometownParts=home.split(",").map(normalize).filter(Boolean);
  const matching=candidates.filter(record=>hometownParts.some(part=>part===normalize(record.city)||part===normalize(record.state)));
  if(matching.length){
    return {home,loc:{x:matching[0].x,y:matching[0].y}};
  }

  // No hometown coordinates found: keep the name but use a valid same-country catalog point instead of 0,0.
  if(candidates.length){
    const fallback=candidates[Math.floor(Math.random()*candidates.length)];
    return {home,loc:{x:fallback.x,y:fallback.y}};
  }
  return {home,loc:{x:0,y:0}};
};
</script>`;
}

async function addLocationAssignment(request, env) {
  const pageResponse = await env.ASSETS.fetch(request);
  if (!pageResponse.ok) return pageResponse;

  const catalogURL = new URL("/data/location-catalog.csv", request.url);
  const catalogResponse = await env.ASSETS.fetch(new Request(catalogURL));
  if (!catalogResponse.ok) return pageResponse;

  const locations = readValidLocations(await catalogResponse.text());
  if (!locations.length) return pageResponse;

  const originalHtml = await pageResponse.text();
  const transformedHtml = transformGenerator(originalHtml);
  if (!transformedHtml) return pageResponse;

  const script = buildLocationScript(locations);
  const bodyClose = transformedHtml.toLowerCase().lastIndexOf("</body>");
  const html = bodyClose >= 0
    ? `${transformedHtml.slice(0, bodyClose)}${script}${transformedHtml.slice(bodyClose)}`
    : `${transformedHtml}${script}`;

  const headers = new Headers(pageResponse.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("content-type", "text/html; charset=utf-8");

  return new Response(html, {
    status: pageResponse.status,
    statusText: pageResponse.statusText,
    headers
  });
}

export default {
  async fetch(request, env, context) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/class-data") {
      const params = new URL(request.url).searchParams;
      const curated =
        params.get("gender") === "women" &&
        params.get("type") === "draft" &&
        params.get("year") === "2026";

      if (!curated) {
        return handleClassData(request);
      }
      const [response, espn] = await Promise.all([
        existingWorker.fetch(request, env, context),
        loadEspnDraftPhotos("women", 2026)
      ]);
      if (!response.ok) return response;
      const body = await response.json();
      if (!Array.isArray(body.players)) return Response.json(body);
      body.players = attachEspnDraftPhotos(body.players, espn.players);
      body.source = { ...body.source, espnPhotos: { status: espn.status, parsed: espn.players.length } };
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      return Response.json(body, { status: response.status, headers });
    }
    if (pathname === "/api/stats") return handleStats(request, env);
    if (pathname === "/api/hometown") return handleHometown(request);
    if (pathname === "/api/headshot") return handleHeadshot(request);
    if (pathname === "/api/describe") return handleDescribe(request, env, context);
    if (pathname === "/" || pathname === "/index.html") {
      return addLocationAssignment(request, env);
    }
    return existingWorker.fetch(request, env, context);
  }
};
