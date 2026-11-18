import existingWorker from "./worker.js";
import { handleClassData, loadEspnDraftPhotos, attachEspnDraftPhotos } from "./class-sources.js";
import { wikidataProfile, wikidataPhotos } from "./enrich.js";
import { handleStats } from "./college-stats.js";
import { handleProSeason } from "./pro-stats.js";

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
const collegeRosterCache = new Map();
const collegeTeamsCache = new Map();

function normalizePersonName(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function cachedCollegeData(cache, key, url) {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.data;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`ESPN college data HTTP ${response.status}`);
  const data = await response.json();
  cache.set(key, { data, expires: Date.now() + 60 * 60 * 1000 });
  return data;
}

async function findCollegeTeamId(league, school) {
  if (!normalizePersonName(school)) return "";
  const data = await cachedCollegeData(collegeTeamsCache, league,
    `https://site.api.espn.com/apis/site/v2/sports/basketball/${league}/teams?limit=500`);
  const teams = data?.sports?.flatMap(sport => sport.leagues || [])
    .flatMap(item => item.teams || []).map(item => item.team).filter(Boolean) || [];
  const wanted = normalizePersonName(school);
  const matches = teams.filter(team =>
    [team.location, team.displayName, team.shortDisplayName].some(value => normalizePersonName(value) === wanted));
  return matches.length === 1 && /^\d{1,8}$/.test(String(matches[0].id)) ? String(matches[0].id) : "";
}

async function collegeRosterPlayer(name, gender, teamId, recruitYear, school = "") {
  if (!Number.isInteger(recruitYear) || recruitYear < 1900 || recruitYear > 2100) return null;
  const league = gender === "women" ? "womens-college-basketball" : "mens-college-basketball";
  if (!teamId) teamId = await findCollegeTeamId(league, school);
  if (!/^\d{1,8}$/.test(String(teamId))) return null;
  const key = `${league}:${teamId}`;
  const roster = await cachedCollegeData(collegeRosterCache, key,
    `https://site.api.espn.com/apis/site/v2/sports/basketball/${league}/teams/${teamId}/roster`);
  const season = Number(roster?.season?.year);
  if (String(roster?.team?.id) !== String(teamId) || !Number.isInteger(season) ||
      season < recruitYear || season > recruitYear + 6 || !Array.isArray(roster.athletes)) return null;
  const athletes = roster.athletes.flatMap(item => Array.isArray(item?.items) ? item.items : [item]).filter(Boolean);
  const matches = athletes.filter(athlete => normalizePersonName(athlete.displayName || athlete.fullName) === normalizePersonName(name));
  if (matches.length !== 1 || !/^\d+$/.test(String(matches[0].id || ""))) return null;
  return matches[0];
}

export async function collegeRosterHeadshot(name, gender, teamId, recruitYear, school = "") {
  const athlete = await collegeRosterPlayer(name, gender, teamId, recruitYear, school);
  if (!athlete) return "";
  const league = gender === "women" ? "womens-college-basketball" : "mens-college-basketball";
  const id = String(athlete.id || "");
  const image = athlete.headshot?.href;
  if (!/^\d+$/.test(id) || typeof image !== "string") return "";
  try {
    const url = new URL(image);
    if (url.protocol !== "https:" || url.hostname !== "a.espncdn.com" ||
        url.pathname !== `/i/headshots/${league}/players/full/${id}.png`) return "";
  } catch (error) {
    return "";
  }
  return image;
}

async function fetchJSON(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) return null;
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

async function findAthlete(name, gender, debug, verifiedId = "") {
  const wanted = normalizeName(name);
  const leagues = ESPN_LEAGUES[gender] || ESPN_LEAGUES.men;
  const query = encodeURIComponent(name);
  const searchURLs = [
    "https://site.web.api.espn.com/apis/common/v3/search?limit=10&type=player&query=" + query,
    "https://site.api.espn.com/apis/common/v3/search?limit=10&type=player&query=" + query,
    "https://site.web.api.espn.com/apis/search/v2?limit=10&query=" + query
  ];

  const found = [];
  for (const url of verifiedId ? [] : searchURLs) {
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
      .filter(item => /^\d{1,10}$/.test(String(item.id)))
      .forEach(item => found.push(String(item.id)));
  }

  const ids = verifiedId ? [verifiedId] : [...new Set(found)];
  if (!ids.length) debug.push("no ESPN match");
  const matches = [];
  for (const id of ids) {
    const profiles = [];
    for (const league of leagues) {
      for (const url of [
        `https://site.web.api.espn.com/apis/common/v3/sports/basketball/${league}/athletes/${id}/overview`,
        `https://sports.core.api.espn.com/v2/sports/basketball/leagues/${league}/athletes/${id}`
      ]) {
        const data = await fetchJSON(url);
        const athlete = data && (data.athlete || data);
        if (!athlete || normalizeName(athlete.displayName || athlete.fullName || athlete.name) !== wanted ||
            (athlete.id && String(athlete.id) !== id)) continue;
        profiles.push(athlete);
        if (athlete.hometown || athlete.homeTown || athlete.birthPlace || athlete.birthplace) break;
      }
    }
    if (profiles.length) matches.push({ id, profiles });
  }
  if (matches.length !== 1) {
    if (matches.length > 1) debug.push("ambiguous ESPN match");
    return null;
  }
  const profiles = matches[0].profiles;
  return {
    homePlace: profiles.map(player => parsePlace(player.hometown || player.homeTown)).find(Boolean),
    birthPlace: profiles.map(player => parsePlace(player.birthPlace || player.birthplace || player.birth_place || player.placeOfBirth)).find(Boolean),
    headshot: profiles.map(player => player.headshot?.href).find(Boolean)
  };
}

function placeText(value) {
  return typeof value === "string" ? value.trim() : String(value?.displayName || value?.name || value?.abbreviation || "").trim();
}

function parsePlace(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const parts = value.split(",").map(part => part.trim()).filter(Boolean);
    if (!parts.length) return null;
    const region = parts[1] || "";
    const isState = US_STATES[region.toUpperCase()] || Object.values(US_STATES).some(state => normalizeName(state) === normalizeName(region));
    return { city: parts[0], state: parts[2] || isState ? region : "", country: parts[2] || (isState ? "US" : region) };
  }
  const city = placeText(value.city);
  if (!city) return null;
  return { city, state: placeText(value.state || value.region || value.province), country: placeText(value.country || value.countryAbbreviation) };
}

function countryCodeFor(country) {
  const value = String(country || "").trim();
  if (/^(united states(?: of america)?|u\.?s\.?a?\.?)$/i.test(value)) return "US";
  if (/^(united kingdom|great britain)$/i.test(value)) return "GB";
  return COUNTRY_CODES[value.toUpperCase()] || (/^[a-z]{2}$/i.test(value) ? value.toUpperCase() : "");
}

function countryNameFor(country) {
  const code = countryCodeFor(country);
  if (code === "US") return "United States";
  if (code) return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || "";
  return country;
}

async function geocode(city, state, country) {
  const data = await fetchJSON(
    "https://geocoding-api.open-meteo.com/v1/search?count=20&language=en&format=json&name=" +
      encodeURIComponent(city)
  );
  const countryCode = countryCodeFor(country);
  const expandedState = (!country || countryCode === "US") ? US_STATES[String(state).toUpperCase()] || state : state;
  const results = ((data && data.results) || []).filter(result =>
    normalizeName(result.name) === normalizeName(city) &&
    Number.isFinite(result.latitude) && Number.isFinite(result.longitude) &&
    (!country || (countryCode ? result.country_code === countryCode : normalizeName(result.country) === normalizeName(country))) &&
    (!state || normalizeName(result.admin1) === normalizeName(expandedState) ||
      normalizeName(result.admin1_code) === normalizeName(state))
  );
  const regions = new Set(results.map(result => `${result.country_code}:${normalizeName(result.admin1)}`));
  const best = regions.size === 1 ? results[0] : null;
  return best ? { lat: best.latitude, lon: best.longitude, countryName: best.country } : null;
}

async function resolveHometown(name, gender, sourceHome, sourceBirth, rosterPlayer, recruit, espnId) {
  const debug = [];
  const verifiedId = rosterPlayer ? String(rosterPlayer.id) : espnId;
  const rosterHome = parsePlace(rosterPlayer?.hometown || rosterPlayer?.homeTown);
  const rosterBirth = parsePlace(rosterPlayer?.birthPlace || rosterPlayer?.birthplace || rosterPlayer?.birth_place || rosterPlayer?.placeOfBirth);
  let athlete = null;
  try {
    athlete = (recruit && !verifiedId) || rosterHome ? null : await findAthlete(name, gender, debug, verifiedId);
  } catch (error) {
    console.warn("ESPN athlete lookup failed", name, error);
    debug.push("ESPN lookup failed");
  }
  const wikiFallback = async headshot => {
    try {
      const wiki = await wikidataProfile(name);
      if (!wiki) return { headshot, debug };
      let point = Number.isFinite(wiki.lat) && Number.isFinite(wiki.lon)
        ? { lat: wiki.lat, lon: wiki.lon } : null;
      if (!point && wiki.city) {
        try {
          point = await geocode(wiki.city, wiki.region, wiki.country);
        } catch (error) {
          console.warn("Wikidata birthplace geocoding failed", name, error);
        }
        if (!point) debug.push("geocode failed");
      }
      return {
        home: wiki.home || undefined,
        headshot,
        x: point ? Math.round(point.lat * 100) : undefined,
        y: point ? Math.round(point.lon * 100) : undefined,
        countryName: wiki.country === "United States of America" ? "United States" : wiki.country || undefined,
        locationSource: "Wikidata birthplace",
        debug: debug.concat("wikidata")
      };
    } catch (error) {
      return { headshot, debug: debug.concat(String(error)) };
    }
  };
  const place = parsePlace(sourceHome) || rosterHome || athlete?.homePlace || parsePlace(sourceBirth) || rosterBirth || athlete?.birthPlace;
  const headshot = athlete?.headshot || undefined;
  if (!place) {
    if (debug.includes("ambiguous ESPN match")) return { headshot, debug };
    return wikiFallback(headshot);
  }

  const rawCountry = place.country || (place.state && (US_STATES[place.state.toUpperCase()] || Object.values(US_STATES).includes(place.state)) ? "US" : "");
  const isUS = countryCodeFor(rawCountry) === "US";
  const stateName = isUS
    ? US_STATES[String(place.state || "").toUpperCase()] || place.state || ""
    : place.state || "";

  const home = sourceHome || [place.city, stateName, isUS ? "" : rawCountry].filter(Boolean).join(", ");
  const locationSource = sourceHome ? "class source hometown" : rosterHome || athlete?.homePlace ? "ESPN hometown"
    : sourceBirth ? "class source birthplace" : "ESPN birthplace";
  let point;
  try {
    point = await geocode(place.city, stateName, rawCountry);
  } catch (error) {
    console.warn("Hometown geocoding failed", name, error);
    debug.push("geocoding service failed");
  }
  if (!point) {
    return { home, headshot, countryName: countryNameFor(rawCountry), locationSource, debug: debug.concat("geocode failed") };
  }

  return {
    home,
    headshot,
    x: Math.round(point.lat * 100),
    y: Math.round(point.lon * 100),
    countryName: isUS ? "United States" : point.countryName,
    locationSource
  };
}

async function handleHometown(request) {
  const params = new URL(request.url).searchParams;
  const name = (params.get("name") || "").trim();
  const gender = params.get("gender") === "women" ? "women" : "men";
  if (!name) return Response.json({});

  const teamId = params.get("team") || "";
  const school = params.get("college") || "";
  const recruitYear = Number(params.get("recruitYear"));
  const verifiedPhotosOnly = params.get("recruit") === "1";
  const country = params.get("ctry") || "";
  const sourceHome = (params.get("home") || "").trim();
  const sourceBirth = (params.get("birthplace") || "").trim();
  const espnId = /^\d{1,10}$/.test(params.get("espnId") || "") ? params.get("espnId") : "";
  const key = JSON.stringify([gender, normalizePersonName(name), teamId, normalizePersonName(school), recruitYear, verifiedPhotosOnly, country, sourceHome, sourceBirth, espnId]);
  let entry = hometownCache.get(key);
  if (!entry || entry.expires <= Date.now()) {
    const collegePromise = collegeRosterPlayer(name, gender, teamId, recruitYear, school);
    const [college, photos] = await Promise.allSettled([collegePromise, wikidataPhotos(name)]);
    const hometown = await Promise.allSettled([
      resolveHometown(name, gender, sourceHome, sourceBirth, college.status === "fulfilled" ? college.value : null, verifiedPhotosOnly, espnId)
    ]).then(results => results[0]);
    if (hometown.status === "rejected") console.warn("Hometown lookup failed", name, hometown.reason);
    if (photos.status === "rejected") console.warn("Wikimedia photo lookup failed", name, photos.reason);
    if (college.status === "rejected") console.warn("College roster lookup failed", name, college.reason);
    const collegePhoto = college.status === "fulfilled" && college.value
      ? await collegeRosterHeadshot(name, gender, teamId, recruitYear, school) : "";
    const hometownResult = hometown.status === "fulfilled" ? hometown.value : {};
    if (verifiedPhotosOnly) delete hometownResult.headshot;
    const result = {
      ...hometownResult,
      headshots: [
        ...(collegePhoto ? [collegePhoto] : []),
        ...(photos.status === "fulfilled" ? photos.value : [])
      ]
    };
    const failed = hometown.status === "rejected" || photos.status === "rejected" || college.status === "rejected" ||
      hometownResult.debug?.some(message => message === "ESPN lookup failed" || message === "geocode failed");
    entry = { result, failed, expires: Date.now() + 60 * 60 * 1000 };
    if (!failed && (result.home || result.headshot || result.headshots.length)) hometownCache.set(key, entry);
    else hometownCache.delete(key);
  }
  return Response.json(entry.result, { headers: { "cache-control": entry.failed ? "no-store" : "public, max-age=3600" } });
}

const HEADSHOT_HOSTS = ["a.espncdn.com", "cdn.nba.com", "commons.wikimedia.org", "upload.wikimedia.org"];
const VISION_MODEL = "@cf/moondream/moondream3.1-9B-A2B";
const VISION_PROMPT = "The left side is a photo of a basketball player. The right side shows labeled skin and hair color swatches. Compare the player's visible face and hair directly to the swatches, allowing for lighting and shadows. Do not infer color from race or the background. Use unknown for an obscured or uncertain feature. Describe the visible hairstyle using simple words for length, texture, braids, locs, curls, buns or ponytail. Output only these semicolon-separated fields: skin: <skin swatch code such as L1 or D4 or unknown>; hair color: <hair swatch code such as H1, T2, R1, K2 or unknown>; hairstyle: <visible description or unknown>; facial hair: <clean shaven, chin patch, mustache, goatee, short beard, full beard, long beard or unknown>; accessory: <none, headband, wide headband, goggles, glasses, bandana, visor, cap or unknown>.";

function normalizeVisionResponse(answer) {
  const text = String(answer || "").toLowerCase().replace(/[^a-z0-9,;:() -]/g, " ").replace(/\s+/g, " ").trim().slice(0, 1000);
  const fields = [...text.matchAll(/\b(skin(?: tone)?|hair colou?r|hair\s*style|facial hair|accessory)\s*:\s*/g)];
  const output = [], seen = new Set();
  for (let i = 0; i < fields.length; i++) {
    const raw = fields[i][1];
    const name = raw.startsWith("skin") ? "skin" : /^hair colou?r$/.test(raw) ? "hair color"
      : /^hair\s*style$/.test(raw) ? "hairstyle" : raw;
    const value = text.slice(fields[i].index + fields[i][0].length, fields[i + 1]?.index ?? text.length)
      .replace(/^[,; ]+|[,; ]+$/g, "");
    if (value && !seen.has(name)) {
      output.push(name + ": " + value);
      seen.add(name);
    }
  }
  return output.join("; ");
}

function salvageVisionResponse(raw) {
  const text = String(raw || "").toLowerCase().replace(/\s+/g, " ").trim();
  const skin = text.match(/\bskin[^a-z0-9]{0,12}(?:swatch |code )?([lmbd][1-9])\b/)?.[1] || text.match(/\b([lmbd][1-9])\b/)?.[1];
  const hair = text.match(/\bhair[^;]{0,25}?\b([htrk][1-9])\b/)?.[1] || text.match(/\b([htrk][1-9])\b/)?.[1];
  const style = text.match(/hair\s*style\s*:\s*([^;]+)/)?.[1]?.trim();
  const fields = [];
  if (skin) fields.push("skin: " + skin);
  if (hair) fields.push("hair color: " + hair);
  if (style && !/^(unknown|unclear)/.test(style)) fields.push("hairstyle: " + style);
  return fields.join("; ");
}

async function handleDescribe(request, env, ctx) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (!env.AI) return json({ ok: false, error: "AI binding missing" });
  if (request.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
  const source = new URL(request.url).searchParams.get("src") || "";
  let target;
  try {
    target = new URL(source);
  } catch (error) {
    return json({ ok: false, error: "bad src" }, 400);
  }
  if (target.protocol !== "https:" || !HEADSHOT_HOSTS.includes(target.hostname)) return json({ ok: false, error: "forbidden" }, 403);
  try {
    const type = (request.headers.get("content-type") || "").split(";")[0];
    if (type !== "image/jpeg") return json({ ok:false, error:"JPEG required" }, 415);
    if (Number(request.headers.get("content-length")) > 1500000) return json({ ok:false, error:"image too large" }, 413);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > 1500000) return json({ ok:false, error:"image too large" }, 413);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return json({ ok:false, error:"invalid JPEG" }, 400);
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map(value => value.toString(16).padStart(2, "0")).join("");
    const cache = caches.default;
    const cacheKey = new Request("https://describe.local/?version=5&src=" + encodeURIComponent(target.toString()) + "&image=" + digest);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    const image = "data:image/jpeg;base64," + btoa(binary);
    const ask = async question => {
      const result = await env.AI.run(VISION_MODEL, { task:"query", image, question, reasoning:false, max_tokens:180 });
      const raw = result?.answer ?? result?.response ?? result?.text ?? (typeof result === "string" ? result : "");
      return String(raw || "");
    };
    const usable = value => value && !value.split("; ").every(field => /:\s*(unknown|unclear|not visible)$/.test(field));
    const rawFull = await ask(VISION_PROMPT);
    let text = normalizeVisionResponse(rawFull);
    if (!usable(text)) text = salvageVisionResponse(rawFull);
    let rawParts = "";
    if (!usable(text)) {
      const [skin, hairColor, hairstyle] = await Promise.all([
        ask("The left side is a photo of a person. The right side has labeled skin swatches (L, M, B, D rows). Which single skin swatch code best matches the person's face? Answer with only the code, like M2."),
        ask("The left side is a photo of a person. The right side has labeled hair color swatches (H, T, R, K rows). Which single hair swatch code best matches the person's hair? Answer with only the code, like K1."),
        ask("Describe this person's hairstyle in a few simple words (length, texture, braids, locs, curls, bun, ponytail).")
      ]);
      rawParts = [skin, hairColor, hairstyle].join(" | ");
      text = salvageVisionResponse([
        "skin: " + (skin.match(/\b[lmbd][1-9]\b/i)?.[0] || "unknown"),
        "hair color: " + (hairColor.match(/\b[htrk][1-9]\b/i)?.[0] || "unknown"),
        "hairstyle: " + (hairstyle.replace(/[^a-zA-Z ,-]/g, " ").trim().slice(0, 120) || "unknown")
      ].join("; "));
    }
    if (!usable(text)) {
      return json({ ok: false, error: "unusable vision response: " + String(rawFull || rawParts).slice(0, 160) });
    }
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
  let upstream;
  for (let redirects = 0; redirects <= 3; redirects++) {
    upstream = await fetch(target.toString(), { redirect:"manual" });
    if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
    const location = upstream.headers.get("location");
    if (!location || redirects === 3) return new Response("Invalid image redirect", { status:502 });
    try { target = new URL(location, target); }
    catch (error) { return new Response("Invalid image redirect", { status:502 }); }
    if (target.protocol !== "https:" || !HEADSHOT_HOSTS.includes(target.hostname)) {
      return new Response("Forbidden image redirect", { status:403 });
    }
  }
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
    "const player = {\n    isReal: Boolean(sourcePlayer),\n    homeX: sourcePlayer ? sourcePlayer.homeX : undefined,\n    homeY: sourcePlayer ? sourcePlayer.homeY : undefined,\n    homeCountry: sourcePlayer ? sourcePlayer.homeCountry : undefined,"
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
      home: "Phillipsburg, New Jersey",
      country: "United States",
      // Phillipsburg, NJ in the catalog's integer coordinate scale (lat/lon × 100).
      target: { x: 4069, y: -7519 }
    }
  };

  return `<script>
window.__HOOPLAND_LOCATION_RECORDS=${JSON.stringify(locations)};
window.__HOOPLAND_REAL_PLAYER_HOMETOWNS=${JSON.stringify(realPlayerHometowns)};
window.__HOOPLAND_US_STATES=${JSON.stringify(US_STATES)};
window.__HOOPLAND_NORMALIZE_LOCATION_NAME=${normalizeName.toString()};
window.__HOOPLAND_REAL_HOMETOWN=function(sourcePlayer){
  const fullName=[sourcePlayer&&sourcePlayer.fn,sourcePlayer&&sourcePlayer.ln].filter(Boolean).join(" ");
  const known=window.__HOOPLAND_REAL_PLAYER_HOMETOWNS[window.__HOOPLAND_NORMALIZE_LOCATION_NAME(fullName)];
  if(known&&known.home)return known.home;
  return String(sourcePlayer&&(sourcePlayer.hometown||sourcePlayer.home)||"").trim();
};
window.__HOOPLAND_VISION_SHEET=async function(source){
  const response=await fetch("/api/headshot?src="+encodeURIComponent(source));
  if(!response.ok)throw new Error("Reference photo HTTP "+response.status);
  const bitmap=await createImageBitmap(await response.blob());
  try{
    const canvas=document.createElement("canvas");
    canvas.width=900;canvas.height=600;
    const ctx=canvas.getContext("2d");
    if(!ctx)throw new Error("Canvas unavailable");
    ctx.fillStyle="#e8e8e8";ctx.fillRect(0,0,900,600);
    const scale=Math.min(520/bitmap.width,600/bitmap.height);
    ctx.drawImage(bitmap,(520-bitmap.width*scale)/2,(600-bitmap.height*scale)/2,bitmap.width*scale,bitmap.height*scale);
    ctx.font="bold 20px sans-serif";ctx.textAlign="left";ctx.textBaseline="middle";
    ctx.fillStyle="#111";ctx.fillText("SKIN",535,32);ctx.fillText("HAIR",535,310);
    const drawRow=(colors,label,y)=>{
      colors.forEach((color,index)=>{
        const x=535+index*59;
        ctx.fillStyle="#"+color;ctx.fillRect(x,y,55,42);
        ctx.fillStyle=colorLum(color)>130?"#111":"#fff";
        ctx.font="bold 16px sans-serif";ctx.textAlign="center";
        ctx.fillText(label+(index+1),x+27,y+21);
      });
    };
    APPEARANCE_PALETTES.forEach((group,index)=>drawRow(group.skins,["L","M","B","D"][index],54+index*51));
    ["blonde","brunette","red","black"].forEach((group,index)=>drawRow(appearanceHairPalette(group),["H","T","R","K"][index],332+index*51));
    return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Could not encode reference sheet")),"image/jpeg",.88));
  }finally{if(typeof bitmap.close==="function")bitmap.close();}
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
  try{
    const type=document.getElementById("classType").value;
    const year=Number(document.getElementById("draftYear").value);
    if(type==="draft"&&Number.isInteger(year))await prepareProfessionalPotential(players,gender,year);
  }catch(e){console.warn("Professional potential lookup failed",e);}
  const queue=players.slice();
  const worker=async()=>{
    while(queue.length){
      const p=queue.shift();
      let d=null;
      try{
        const q=new URLSearchParams({name:[p.fn,p.ln].filter(Boolean).join(" "),gender:gender==="1"?"women":"men",ctry:String(p.ctry||p.country||""),home:window.__HOOPLAND_REAL_HOMETOWN(p),birthplace:String(p.birthplace||""),espnId:String(p.espnId||""),team:String(p.collegeTeamId||""),college:String(p.committedCollege||""),recruitYear:String(p.recruitYear||""),recruit:p.recruitYear?"1":"",v:"4"});
        const res=await fetch("/api/hometown?"+q);
        d=res.ok?await res.json():null;
      }catch(e){console.warn('Hometown and photo lookup failed for',[p.fn,p.ln].join(' '),e);}
      if(d){
        if(d.home&&!window.__HOOPLAND_REAL_HOMETOWN(p)){p.hometown=d.home;}
        if(d.home===window.__HOOPLAND_REAL_HOMETOWN(p)&&Number.isFinite(d.x)&&Number.isFinite(d.y)){p.homeX=d.x;p.homeY=d.y;}
        if(d.home===window.__HOOPLAND_REAL_HOMETOWN(p)&&d.countryName)p.homeCountry=d.countryName;
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
      p.referencePhotos=shots;
      if(shots.length){
        const descriptions=[];
        const failures=[];
        let attempted=0;
        for(const shot of shots){
          if(descriptions.length===4)break;
          attempted++;
          try{
            const sheet=await window.__HOOPLAND_VISION_SHEET(shot);
            const r=await fetch("/api/describe?src="+encodeURIComponent(shot),{method:"POST",headers:{"content-type":"image/jpeg"},body:sheet});
            const j=r.ok?await r.json():null;
            if(j&&j.ok&&j.text)descriptions.push(j.text);
            else {
              const reason=String(j&&j.error||("HTTP "+r.status));
              failures.push(reason);
              console.warn('Headshot description unavailable for',[p.fn,p.ln].join(' '),reason);
            }
          }catch(e){
            failures.push(String(e&&e.message||e));
            console.warn('Headshot description failed for',[p.fn,p.ln].join(' '),e);
          }
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
          if(!descriptions.length)p.appearanceWarnings.push('Photo descriptions unavailable; unsaved features are placeholders. '+[...new Set(failures)].join('; '));
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
        if(combined.conflicts.includes('skin')){
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
    const fictionalCountries={US:"United States",CA:"Canada",AU:"Australia",FR:"France",UK:"United Kingdom",GB:"United Kingdom",DE:"Germany",ES:"Spain",RS:"Serbia",BE:"Belgium"};
    const fictionalCountry=fictionalCountries[String(player&&player.ctry||"").toUpperCase()];
    const sameCountry=fictionalCountry?records.filter(record=>normalize(record.country)===normalize(fictionalCountry)):[];
    const pool=sameCountry.length?sameCountry:records;
    const fictionalLocation=pool[Math.floor(Math.random()*pool.length)];
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

  const hometownParts=home.split(",").map(part=>part.trim()).filter(Boolean);
  const region=hometownParts[1]||"";
  const expandedRegion=window.__HOOPLAND_US_STATES[region.toUpperCase()]||region;
  const matching=candidates.filter(record=>normalize(hometownParts[0])===normalize(record.city)&&
    (!region||normalize(expandedRegion)===normalize(record.state)||normalize(region)===normalize(record.country)));
  if(matching.length===1){
    return {home,loc:{x:matching[0].x,y:matching[0].y}};
  }

  // No hometown coordinates found: keep the name but use a valid same-country catalog point instead of 0,0.
  if(candidates.length){
    console.warn("Using approximate location: hometown coordinates unavailable",fullName,home);
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
    if (pathname === "/api/pro-season") return handleProSeason(request);
    if (pathname === "/api/hometown") return handleHometown(request);
    if (pathname === "/api/headshot") return handleHeadshot(request);
    if (pathname === "/api/describe") return handleDescribe(request, env, context);
    if (pathname === "/" || pathname === "/index.html") {
      return addLocationAssignment(request, env);
    }
    return existingWorker.fetch(request, env, context);
  }
};
