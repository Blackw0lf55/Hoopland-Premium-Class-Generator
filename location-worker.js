import existingWorker from "./worker.js";
import { handleClassData, loadEspnDraftPlayers, attachEspnDraftPlayers, filterWomenDraftSeniors } from "./class-sources.js";
import { wikidataProfile } from "./enrich.js";
import { handleStats } from "./college-stats.js";
import { handleProSeason } from "./pro-stats.js";
import { womenRosterLookup, womenRosterCandidates } from "./women-rosters.js";
import { athleteDimensions } from "./measurements.js";

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
    .filter(row => row.length >= 5 && row[row.length - 2] !== "" && row[row.length - 1] !== "")
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

export async function collegeRosterPlayer(name, gender, teamId, recruitYear, school = "", draftYear = 0) {
  const isDraft = Number.isInteger(draftYear) && draftYear >= 1900 && draftYear <= 2100;
  if (!isDraft && (!Number.isInteger(recruitYear) || recruitYear < 1900 || recruitYear > 2100)) return null;
  const league = gender === "women" ? "womens-college-basketball" : "mens-college-basketball";
  if (!teamId) teamId = await findCollegeTeamId(league, school);
  if (!/^\d{1,8}$/.test(String(teamId))) return null;
  const key = `${league}:${teamId}:${isDraft ? draftYear : "current"}`;
  const roster = await cachedCollegeData(collegeRosterCache, key,
    `https://site.api.espn.com/apis/site/v2/sports/basketball/${league}/teams/${teamId}/roster` +
      (isDraft ? `?season=${draftYear}` : ""));
  const season = Number(roster?.season?.year);
  if (String(roster?.team?.id) !== String(teamId) || !Number.isInteger(season) ||
      (isDraft ? season !== draftYear : season < recruitYear || season > recruitYear + 6) ||
      !Array.isArray(roster.athletes)) return null;
  const athletes = roster.athletes.flatMap(item => Array.isArray(item?.items) ? item.items : [item]).filter(Boolean);
  const matches = athletes.filter(athlete => normalizePersonName(athlete.displayName || athlete.fullName) === normalizePersonName(name));
  if (matches.length !== 1 || !/^\d+$/.test(String(matches[0].id || ""))) return null;
  return matches[0];
}

export async function verifyWomenDraftSenior(player, year, env) {
  if (env?.ASSETS) {
    try {
      const roster = await womenRosterLookup(env, year, player);
      if (roster) {
        if (/^\d{1,2}$/.test(roster.jersey)) player.jersey = roster.jersey;
        if (!(Number(player.height) >= 48 && Number(player.height) <= 100) &&
            roster.height >= 48 && roster.height <= 100) player.height = roster.height;
        if (/^senior$/i.test(roster.grade)) return true;
        if (/^(freshman|sophomore|junior|fifth year|graduate)$/i.test(roster.grade)) return false;
      }
    } catch (error) {
      console.warn("Women's school-roster reference unavailable", error);
    }
  }
  const athlete = await collegeRosterPlayer(
    [player.fn,player.ln].filter(Boolean).join(" "), "women",
    player.collegeTeamId, player.recruitYear,
    player.committedCollege || player.school || player.team || "", year
  );
  if (!athlete) return null;
  if (/^\d{1,2}$/.test(String(athlete.jersey || ""))) player.jersey = String(athlete.jersey);
  const value = athlete.experience?.displayValue || athlete.experience?.abbreviation ||
    athlete.class?.displayValue || athlete.class?.abbreviation || athlete.classYear ||
    (typeof athlete.class === "string" ? athlete.class : "");
  if (/^(?:senior|sr\.?)$/i.test(String(value).trim())) return true;
  if (/^(?:freshman|sophomore|junior|graduate|fr\.?|so\.?|jr\.?|gr\.?)$/i.test(String(value).trim())) return false;
  return null;
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
        const dimensions = athleteDimensions(athlete);
        if ((athlete.hometown || athlete.homeTown || athlete.birthPlace || athlete.birthplace) &&
            dimensions.height && dimensions.weight) break;
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
    height: profiles.map(player => athleteDimensions(player).height).find(Boolean),
    weight: profiles.map(player => athleteDimensions(player).weight).find(Boolean)
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
  const rosterDimensions = athleteDimensions(rosterPlayer);
  let athlete = null;
  try {
    athlete = (recruit && !verifiedId) || (rosterHome && rosterDimensions.height && rosterDimensions.weight)
      ? null : await findAthlete(name, gender, debug, verifiedId);
  } catch (error) {
    console.warn("ESPN athlete lookup failed", name, error);
    debug.push("ESPN lookup failed");
  }
  const wikiFallback = async () => {
    try {
      const wiki = await wikidataProfile(name);
      if (!wiki) return { debug };
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
        x: point ? Math.round(point.lat * 100) : undefined,
        y: point ? Math.round(point.lon * 100) : undefined,
        countryName: wiki.country === "United States of America" ? "United States" : wiki.country || undefined,
        locationSource: "Wikidata birthplace",
        debug: debug.concat("wikidata")
      };
    } catch (error) {
      return { debug: debug.concat(String(error)) };
    }
  };
  const place = parsePlace(sourceHome) || rosterHome || athlete?.homePlace || parsePlace(sourceBirth) || rosterBirth || athlete?.birthPlace;
  const dimensions = {
    ...(rosterDimensions.height || (verifiedId && athlete?.height) ? {height:rosterDimensions.height || athlete.height} : {}),
    ...(rosterDimensions.weight || (verifiedId && athlete?.weight) ? {weight:rosterDimensions.weight || athlete.weight} : {})
  };
  if (!place) {
    if (debug.includes("ambiguous ESPN match")) return { debug, ...dimensions };
    return {...await wikiFallback(), ...dimensions};
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
    return { home, countryName: countryNameFor(rawCountry), locationSource, debug: debug.concat("geocode failed"), ...dimensions };
  }

  return {
    home,
    x: Math.round(point.lat * 100),
    y: Math.round(point.lon * 100),
    countryName: isUS ? "United States" : point.countryName,
    locationSource,
    ...dimensions
  };
}

async function nbaPlayerDimensions(name, gender, id) {
  const response = await fetch(
    `https://stats.nba.com/stats/commonplayerinfo?LeagueID=${gender === "women" ? "10" : "00"}&PlayerID=${id}`,
    {headers:{"User-Agent":"Mozilla/5.0",Referer:"https://www.nba.com/",Origin:"https://www.nba.com",Accept:"application/json"},
      signal:AbortSignal.timeout(8000)}
  );
  if (!response.ok) throw new Error(`NBA player profile HTTP ${response.status}`);
  const data = await response.json();
  const set = data.resultSets?.find(item => item.name === "CommonPlayerInfo");
  if (!Array.isArray(set?.headers) || !Array.isArray(set.rowSet) || set.rowSet.length !== 1) return {};
  const column = key => set.rowSet[0][set.headers.indexOf(key)];
  if (String(column("PERSON_ID")) !== id ||
      normalizePersonName(column("DISPLAY_FIRST_LAST")) !== normalizePersonName(name)) return {};
  return athleteDimensions({displayHeight:column("HEIGHT"),weight:column("WEIGHT")});
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
  const draftYear = verifiedPhotosOnly ? 0 : Number(params.get("draftYear"));
  const country = params.get("ctry") || "";
  const sourceHome = (params.get("home") || "").trim();
  const sourceBirth = (params.get("birthplace") || "").trim();
  const espnId = /^\d{1,10}$/.test(params.get("espnId") || "") ? params.get("espnId") : "";
  const nbaId = /^\d{1,10}$/.test(params.get("nbaId") || "") ? params.get("nbaId") : "";
  const needsDimensions = params.get("measure") === "1";
  const key = JSON.stringify([gender, normalizePersonName(name), teamId, normalizePersonName(school), recruitYear, draftYear, verifiedPhotosOnly, country, sourceHome, sourceBirth, espnId, nbaId, needsDimensions]);
  let entry = hometownCache.get(key);
  if (!entry || entry.expires <= Date.now()) {
    const [college] = await Promise.allSettled([collegeRosterPlayer(name, gender, teamId, recruitYear, school, draftYear)]);
    const hometown = await Promise.allSettled([
      resolveHometown(name, gender, sourceHome, sourceBirth, college.status === "fulfilled" ? college.value : null, verifiedPhotosOnly, espnId)
    ]).then(results => results[0]);
    if (hometown.status === "rejected") console.warn("Hometown lookup failed", name, hometown.reason);
    if (college.status === "rejected") console.warn("College roster lookup failed", name, college.reason);
    const hometownResult = hometown.status === "fulfilled" ? hometown.value : {};
    let measurementUnavailable = false;
    if (needsDimensions && nbaId && (!hometownResult.height || !hometownResult.weight)) {
      try {
        const dimensions = await nbaPlayerDimensions(name, gender, nbaId);
        if (!hometownResult.height && dimensions.height) hometownResult.height = dimensions.height;
        if (!hometownResult.weight && dimensions.weight) hometownResult.weight = dimensions.weight;
        measurementUnavailable = !hometownResult.height || !hometownResult.weight;
      } catch (error) {
        console.warn("NBA player measurements unavailable", name, error);
        measurementUnavailable = true;
      }
    }
    const result = {
      ...hometownResult,
      ...(college.status === "fulfilled" && /^\d{1,2}$/.test(String(college.value?.jersey || ""))
        ? {jersey:String(college.value.jersey)} : {})
    };
    const failed = measurementUnavailable || hometown.status === "rejected" || college.status === "rejected" ||
      hometownResult.debug?.some(message => message === "ESPN lookup failed" || message === "geocode failed");
    entry = { result, failed, expires: Date.now() + 60 * 60 * 1000 };
    if (!failed && (result.home || result.height || result.weight || result.jersey)) hometownCache.set(key, entry);
    else hometownCache.delete(key);
  }
  return Response.json(entry.result, { headers: { "cache-control": entry.failed ? "no-store" : "public, max-age=3600" } });
}

export class SharedAppearance {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const baseline = new URL(request.url).pathname === "/baseline";
    const ratings = new URL(request.url).pathname === "/ratings";
    const roster = new URL(request.url).pathname === "/roster";
    if (request.method === "GET") {
      if (roster) return Response.json({ok:true, player:await this.state.storage.get("roster") || null},
        { headers: { "cache-control":"no-store" } });
      if (ratings) return Response.json({ok:true, ratings:await this.state.storage.get("ratings") || []},
        { headers: { "cache-control":"no-store" } });
      const appearances = await this.state.storage.get("appearances");
      const reference = await this.state.storage.get("baseline");
      return Response.json({ ok: true, appearances: appearances || [], hasEdits: appearances !== undefined, baseline: reference || null },
        { headers: { "cache-control": "no-store" } });
    }
    const data = await request.json();
    let saved = true;
    await this.state.storage.transaction(async txn => {
      if (roster) {
        const previous = await txn.get("roster") || {attributes:{},bio:{},tendencies:{}};
        const attributes = {...previous.attributes};
        for (const [code,pair] of Object.entries(data.attributes || {})) {
          const old = attributes[code];
          attributes[code] = old ? [Math.min(old[0],pair[0]),Math.min(old[1],pair[1])] : pair;
        }
        await txn.put("roster", {attributes, bio:{...data.bio,...previous.bio},
          tendencies:{...data.tendencies,...previous.tendencies}});
      } else if (baseline) {
        if (await txn.get("baseline")) { saved = false; return; }
        await txn.put("baseline", data);
      } else if (ratings) {
        const previous = await txn.get("ratings") || [];
        await txn.put("ratings", [...previous, data.ratings].slice(-5));
      } else {
        const previous = await txn.get("appearances") || data.legacy || [];
        await txn.put("appearances", [...previous, data.appearance].slice(-5));
      }
    });
    return Response.json({ ok: true, saved }, { headers: { "cache-control": "no-store" } });
  }
}

async function handleImportedRoster(request, env) {
  const headers = {"cache-control":"no-store"};
  const fail = (error,status) => Response.json({ok:false,error},{status,headers});
  if (!env.APPEARANCES) return fail("Imported roster storage is unavailable.",503);
  if (!["GET","PUT"].includes(request.method)) return fail("Method not allowed.",405);
  const url = new URL(request.url);
  const name = (url.searchParams.get("name") || "").trim();
  const gender = url.searchParams.get("gender"), type = url.searchParams.get("type");
  const year = Number(url.searchParams.get("year")), normalized = normalizePersonName(name);
  if (!normalized || name.length>100 || normalized.length>100 || !["men","women"].includes(gender) ||
      !["pro","college"].includes(type) || !Number.isInteger(year) || year<1900 || year>2100) {
    return fail("Invalid player identity.",400);
  }
  const object = env.APPEARANCES.get(env.APPEARANCES.idFromName(JSON.stringify(["roster",gender,type,year,normalized])));
  if (request.method === "GET") return object.fetch("https://appearance.internal/roster",{method:"GET"});
  if (request.headers.get("origin") !== url.origin) return fail("Invalid request origin.",403);
  if ((request.headers.get("content-type") || "").split(";")[0] !== "application/json") return fail("JSON required.",415);
  if (!request.body || Number(request.headers.get("content-length")) > 4096) return fail("Invalid request size.",413);
  const reader=request.body.getReader(), decoder=new TextDecoder();
  let text="", size=0;
  while (true) {
    const {value,done}=await reader.read();
    if (done) break;
    size+=value.byteLength;
    if (size>4096) { await reader.cancel(); return fail("Request too large.",413); }
    text+=decoder.decode(value,{stream:true});
  }
  text+=decoder.decode();
  let data;
  try { data=JSON.parse(text); } catch { return fail("Invalid JSON.",400); }
  const objectValue=value=>value && typeof value==="object" && !Array.isArray(value);
  const skills=["LAY","DNK","INS","MID","TPT","FTS","DRB","PAS","ORE","DRE","STL","BLK"];
  const physical=["SPD","STR","STM"];
  const tendencies=["dunk","floater","hook","post","twoPoint","threePoint","pumpFake","fades","pass","lob",
    "cross","spin","step","offReb","runPlay","defReb","takeCharge","stealOnBall","stealOffBall","block"];
  const bounds={age:[15,60],height:[48,100],weight:[70,500],position:[0,8],years:[0,30],jersey:[0,99]};
  if (!objectValue(data) || Object.keys(data).some(key=>!["attributes","bio","tendencies"].includes(key)) ||
      !["attributes","bio","tendencies"].every(key=>objectValue(data[key])) ||
      !Object.values(data).some(value=>Object.keys(value).length) ||
      Object.entries(data.attributes).some(([key,pair])=>
        ![...skills,...physical].includes(key) || !Array.isArray(pair) || pair.length!==2 ||
        pair.some(value=>!Number.isInteger(value) || value<(physical.includes(key)?8:2) || value>20) ||
        pair[0]>pair[1] || (physical.includes(key) && pair[0]!==pair[1])) ||
      Object.entries(data.tendencies).some(([key,value])=>!tendencies.includes(key) || !Number.isInteger(value) || value< -5 || value>5) ||
      Object.entries(data.bio).some(([key,value])=>
        key==="home" || key==="country" ? typeof value!=="string" || value.length>100
        : !Object.hasOwn(bounds,key) || !Number.isInteger(value) || value<bounds[key][0] || value>bounds[key][1])) {
    return fail("Invalid imported player data.",400);
  }
  return object.fetch("https://appearance.internal/roster",{
    method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(data)
  });
}

async function handleSharedRatings(request, env) {
  const headers = {"cache-control":"no-store"};
  const fail = (error,status) => Response.json({ok:false,error},{status,headers});
  if (!env.APPEARANCES) return fail("Shared attribute storage is unavailable.",503);
  if (!["GET","PUT"].includes(request.method)) return fail("Method not allowed.",405);
  const url = new URL(request.url);
  const gender = url.searchParams.get("gender");
  const name = (url.searchParams.get("name") || "").trim();
  const normalized = normalizePersonName(name);
  if (!normalized || name.length>100 || normalized.length>100 || !["men","women"].includes(gender)) {
    return fail("Invalid player identity.",400);
  }
  const object = env.APPEARANCES.get(env.APPEARANCES.idFromName(JSON.stringify(["player",gender,normalized])));
  if (request.method === "GET") return object.fetch("https://appearance.internal/ratings",{method:"GET"});
  if (request.headers.get("origin") !== url.origin) return fail("Invalid request origin.",403);
  if ((request.headers.get("content-type") || "").split(";")[0] !== "application/json") return fail("JSON required.",415);
  if (Number(request.headers.get("content-length")) > 1024 || !request.body) return fail("Invalid request size.",413);
  const reader = request.body.getReader(), decoder = new TextDecoder();
  let text="", size=0;
  while (true) {
    const {value,done}=await reader.read();
    if (done) break;
    size+=value.byteLength;
    if (size>1024) { await reader.cancel(); return fail("Request too large.",413); }
    text+=decoder.decode(value,{stream:true});
  }
  text+=decoder.decode();
  let ratings;
  try { ratings=JSON.parse(text); } catch { return fail("Invalid JSON.",400); }
  const skills=["LAY","DNK","INS","MID","TPT","FTS","DRB","PAS","ORE","DRE","STL","BLK"];
  const physical=["SPD","STR","STM"];
  const archetypes=["Floor General","Scoring Guard","Sharpshooter","Slasher","3-and-D Wing","Shot-Creating Wing",
    "Point Forward","Stretch Big","Post Scorer","Rim Runner","Rim Protector","Playmaking Big","GOAT"];
  if (!ratings || typeof ratings!=="object" || Array.isArray(ratings) || !Object.keys(ratings).length ||
      Object.entries(ratings).some(([key,pair])=>
        key==="arc" ? typeof pair!=="string" || !archetypes.includes(pair)
        : ![...skills,...physical].includes(key) || !Array.isArray(pair) || pair.length!==2 ||
        pair.some(value=>!Number.isInteger(value) || value<(physical.includes(key)?8:2) || value>20) ||
        pair[0]>pair[1] || (physical.includes(key) && pair[0]!==pair[1]))) {
    return fail("Invalid attribute values.",400);
  }
  return object.fetch("https://appearance.internal/ratings",{
    method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({ratings})
  });
}

const builtInAppearanceCache = new WeakMap();
async function builtInAppearanceExists(env, gender, normalized) {
  if (!env.ASSETS) throw new Error("Built-in appearance references are unavailable.");
  let loading = builtInAppearanceCache.get(env.ASSETS);
  if (!loading) {
    loading = (async () => {
      const response = await env.ASSETS.fetch(new Request("https://assets.internal/data/roster-reference.js"));
      if (!response.ok) throw new Error("Built-in appearance references are unavailable.");
      const text = await response.text();
      const prefix = "window.HOOPLAND_ROSTER_REFERENCE=";
      if (!text.startsWith(prefix)) throw new Error("Built-in appearance references are invalid.");
      const data = JSON.parse(text.slice(prefix.length).trim().replace(/;$/, ""));
      if (!Array.isArray(data.appearances)) throw new Error("Built-in appearance references are invalid.");
      return new Set(data.appearances.map(entry => entry.gender + ":" + entry.name));
    })();
    builtInAppearanceCache.set(env.ASSETS, loading);
  }
  try {
    return (await loading).has((gender === "women" ? "1" : "0") + ":" + normalized.replace(/ /g, ""));
  } catch (error) {
    builtInAppearanceCache.delete(env.ASSETS);
    throw error;
  }
}

async function handleSharedAppearance(request, env) {
  const headers = { "cache-control": "no-store" };
  const fail = (error, status) => Response.json({ ok: false, error }, { status, headers });
  if (!env.APPEARANCES) return fail("Shared appearance storage is unavailable.", 503);
  if (!["GET", "PUT"].includes(request.method)) return fail("Method not allowed.", 405);
  const url = new URL(request.url);
  const name = (url.searchParams.get("name") || "").trim();
  const gender = url.searchParams.get("gender");
  const type = url.searchParams.get("type");
  const year = Number(url.searchParams.get("year"));
  const baseline = url.pathname === "/api/appearance-baseline";
  const normalized = normalizePersonName(name);
  if (name.length > 100 || !normalized || normalized.length > 100 || !["men", "women"].includes(gender) ||
      !(baseline ? ["pro", "college"] : ["draft", "freshman"]).includes(type) ||
      !Number.isInteger(year) || year < 1900 || year > 2100) {
    return fail("Invalid player identity.", 400);
  }
  let appearance;
  if (request.method === "PUT") {
    if (request.headers.get("origin") !== url.origin) return fail("Invalid request origin.", 403);
    if ((request.headers.get("content-type") || "").split(";")[0] !== "application/json") return fail("JSON required.", 415);
    if (Number(request.headers.get("content-length")) > 1024) return fail("Request too large.", 413);
    if (!request.body) return fail("JSON required.", 400);
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let body = "", size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) {
        await reader.cancel();
        return fail("Request too large.", 413);
      }
      body += decoder.decode(value, { stream:true });
    }
    body += decoder.decode();
    try { appearance = JSON.parse(body); } catch { return fail("Invalid JSON.", 400); }
    if (!appearance || typeof appearance !== "object" || Array.isArray(appearance) ||
        !Object.keys(appearance).length || Object.keys(appearance).some(key => !["skinC","hairC","hair","fHair"].includes(key)) ||
        Object.values(appearance).some(value => typeof value !== "string") ||
        ("skinC" in appearance && !/^[0-9a-f]{6}$/i.test(appearance.skinC)) ||
        ("hairC" in appearance && !/^[0-9a-f]{6}$/i.test(appearance.hairC)) ||
        ("hair" in appearance && (!/^\d{4}$/.test(appearance.hair) || Number(appearance.hair) > 170)) ||
        ("fHair" in appearance && (!/^\d{4}$/.test(appearance.fHair) || Number(appearance.fHair) > 31 || gender === "women"))) return fail("Invalid appearance.", 400);
    if (baseline && !["skinC","hairC","hair",...(gender === "men" ? ["fHair"] : [])].every(key => key in appearance)) {
      return fail("A complete baseline appearance is required.", 400);
    }
  }
  const legacyId = env.APPEARANCES.idFromName(JSON.stringify([gender, type, year, normalized]));
  const globalId = env.APPEARANCES.idFromName(JSON.stringify(["player", gender, normalized]));
  const global = env.APPEARANCES.get(globalId);
  if (baseline) {
    if (request.method !== "PUT") return fail("Method not allowed.", 405);
    try {
      if (await builtInAppearanceExists(env, gender, normalized)) return Response.json({ok:true,saved:false,reason:"built-in reference"}, {headers});
    } catch (error) { return fail(String(error.message || error), 503); }
    return global.fetch("https://appearance.internal/baseline", {
      method:"PUT", headers:{"content-type":"application/json"},
      body:JSON.stringify({appearance, source:{type,year}})
    });
  }
  const currentResponse = await global.fetch("https://appearance.internal/", {method:"GET"});
  if (!currentResponse.ok) return fail("Shared appearance storage failed.", 503);
  const current = await currentResponse.json();
  let legacy = [];
  if (!current.hasEdits) {
    const response = await env.APPEARANCES.get(legacyId).fetch("https://appearance.internal/", {method:"GET"});
    if (!response.ok) return fail("Previous appearance history is unavailable.", 503);
    legacy = (await response.json()).appearances;
  }
  if (request.method === "GET") {
    return Response.json({ok:true, appearances:current.hasEdits ? current.appearances : legacy, baseline:current.baseline}, {headers});
  }
  return global.fetch("https://appearance.internal/", {
    method:"PUT", headers:{"content-type":"application/json"}, body:JSON.stringify({appearance,legacy})
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

  const exportCode = html.slice(exportStart);
  if (!exportCode.includes("window.__HOOPLAND_RESOLVE_LOCATION(player)") ||
      !/loc:\s*assignedLocation\.loc/.test(exportCode) ||
      !/home:\s*assignedLocation\.home/.test(exportCode)) return null;

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
window.__HOOPLAND_PREPARE_REAL_PLAYERS=async function(players,gender){
  const type=document.getElementById("classType").value;
  const year=Number(document.getElementById("draftYear").value);
  let statsDone=0,proDone=0,playersDone=0;
  const report=()=>{
    if(typeof window.__HOOPLAND_PROGRESS==="function")
      window.__HOOPLAND_PROGRESS(0.1+0.7*(statsDone+4*proDone+playersDone)/(players.length+5));
  };
  const statsPromise=(async()=>{try{
    if(type==="draft"&&year>=2008){
      const names=players.map(p=>[p.fn,p.ln].filter(Boolean).join(" "));
      const res=await fetch("/api/stats?gender="+(gender==="1"?"women":"men")+"&year="+year+"&names="+encodeURIComponent(names.join("|")));
      const d=res.ok?await res.json():null;
      if(d&&d.ok){
        players.forEach((p,i)=>{if(d.players[names[i]])p.bart=d.players[names[i]];});
      }else console.warn("College stats unavailable",d&&d.error);
    }
  }catch(e){console.warn("College stats lookup failed",e);}
  finally{statsDone=1;report();}})();
  const proPromise=(async()=>{try{
    if(type==="draft"&&Number.isInteger(year))
      await prepareProfessionalPotential(players,gender,year,new Date(),false,value=>{proDone=value;report();});
    else if(type==="freshman"&&Number.isInteger(year)&&year<=lastCompletedProSeason(gender)-5)
      await prepareProfessionalPotential(players,gender,year,new Date(),true,value=>{proDone=value;report();});
  }catch(e){console.warn("Professional potential lookup failed",e);}
  finally{proDone=1;report();}})();
  const queue=players.slice();
  const identityCounts=new Map();
  for(const p of players){
    const key=window.__HOOPLAND_NORMALIZE_LOCATION_NAME([p.fn,p.ln].filter(Boolean).join(" "));
    identityCounts.set(key,(identityCounts.get(key)||0)+1);
  }
  const worker=async()=>{
    while(queue.length){
      const p=queue.shift();
      const name=[p.fn,p.ln].filter(Boolean).join(" ");
      const identity={name,gender:gender==="1"?"women":"men",type,year:String(year)};
      const identityKey=window.__HOOPLAND_NORMALIZE_LOCATION_NAME(name);
      if(identityKey&&identityCounts.get(identityKey)===1&&Number.isInteger(year)&&year>=1900&&year<=2100){
        p.sharedAppearanceIdentity=identity;
        await Promise.all([(async()=>{try {
          const rosterIdentity={...identity,type:type==="draft"?"pro":"college"};
          const response=await fetch("/api/imported-roster?"+new URLSearchParams(rosterIdentity),{cache:"no-store"});
          const result=await response.json();
          if(!response.ok||!result.ok)throw new Error(result.error||("HTTP "+response.status));
          if(result.player){
            p.importedRatings=result.player.attributes;
            p.importedTendencies=result.player.tendencies;
            const bio=result.player.bio;
            if(bio){
              if(bio.height!==undefined)p.height=bio.height;
              if(bio.weight!==undefined)p.weight=bio.weight;
              if(bio.position!==undefined)p.bioPosition=["PG","G","SG","GF","SF","F","PF","FC","C"][bio.position];
              if(bio.age!==undefined)p.importedAge=bio.age;
              if(bio.jersey!==undefined)p.jersey=String(bio.jersey);
              if(bio.country)p.country=bio.country;
              if(bio.home)p.hometown=bio.home;
            }
          }
        }catch(e){
          console.warn("Imported roster lookup failed for",name,e);
          p.importedRosterError="Imported roster lookup failed: "+String(e&&e.message||e);
        }})(),(async()=>{try {
          const response=await fetch("/api/shared-attributes?"+new URLSearchParams(identity),{cache:"no-store"});
          const result=await response.json();
          if(!response.ok||!result.ok||!Array.isArray(result.ratings))throw new Error(result.error||("HTTP "+response.status));
          p.sharedRatings=result.ratings;
        } catch(e) {
          console.warn("Shared attribute lookup failed for",name,e);
          p.sharedRatingsError="Shared attribute lookup failed: "+String(e&&e.message||e);
        }})(),(async()=>{try{
          const response=await fetch("/api/shared-appearance?"+new URLSearchParams(identity),{cache:"no-store"});
          const result=await response.json();
          if(!response.ok||!result.ok)throw new Error(result.error||("HTTP "+response.status));
          if(result.baseline){
            if(validImportedBaseline(result.baseline.appearance,gender))p.importedBaseline=result.baseline.appearance;
            else p.sharedAppearanceError="The imported appearance baseline is invalid and was not applied.";
          }
          if(Array.isArray(result.appearances)&&result.appearances.length){
            const valid=result.appearances.filter(appearance=>validSharedAppearance(appearance,gender));
            if(valid.length)p.sharedAppearance=combineSharedAppearances(valid,gender);
            if(valid.length!==result.appearances.length)p.sharedAppearanceError="Some community appearance values were unsupported and were not applied.";
          }
        }catch(e){
          console.warn("Shared appearance lookup failed for",name,e);
          p.sharedAppearanceError="Shared appearance lookup failed: "+String(e&&e.message||e);
        }})()]);
      }
      let d=null;
      await statsPromise;
      try{
        const q=new URLSearchParams({name:[p.fn,p.ln].filter(Boolean).join(" "),gender:gender==="1"?"women":"men",ctry:String(p.ctry||p.country||""),home:window.__HOOPLAND_REAL_HOMETOWN(p),birthplace:String(p.birthplace||""),espnId:String(p.espnId||""),nbaId:String(p.proId||""),measure:(!(Number(p.height)>=48&&Number(p.height)<=100)||!(Number(p.weight)>=70&&Number(p.weight)<=500))?"1":"",team:String(p.collegeTeamId||""),college:String(p.committedCollege||(type==="draft"&&(p.school||(p.bart&&p.bart.team)))||""),recruitYear:String(p.recruitYear||""),recruit:p.recruitYear?"1":"",draftYear:type==="draft"?String(year):"",v:"6"});
        const res=await fetch("/api/hometown?"+q);
        d=res.ok?await res.json():null;
      }catch(e){console.warn('Hometown lookup failed for',[p.fn,p.ln].join(' '),e);}
      if(d){
        if(!Number.isFinite(Number(p.height)) || Number(p.height)<48 || Number(p.height)>100) {
          if(Number.isFinite(d.height) && d.height>=48 && d.height<=100)p.height=d.height;
        }
        if(!Number.isFinite(Number(p.weight)) || Number(p.weight)<70 || Number(p.weight)>500) {
          if(Number.isFinite(d.weight) && d.weight>=70 && d.weight<=500)p.weight=d.weight;
        }
        if(!/^\\d{1,2}$/.test(String(p.jersey||"")) && /^\\d{1,2}$/.test(String(d.jersey||"")))p.jersey=String(d.jersey);
        if(d.home&&!window.__HOOPLAND_REAL_HOMETOWN(p)){p.hometown=d.home;}
        if(d.home===window.__HOOPLAND_REAL_HOMETOWN(p)&&Number.isFinite(d.x)&&Number.isFinite(d.y)){p.homeX=d.x;p.homeY=d.y;}
        if(d.home===window.__HOOPLAND_REAL_HOMETOWN(p)&&d.countryName)p.homeCountry=d.countryName;
        if(!d.home)console.warn('Hometown lookup failed for',[p.fn,p.ln].join(' '),d.debug);
      }
      if(p.importedBaseline){
        p.appearanceWarnings=["Using an imported appearance baseline; name matching is not guaranteed. Please review."];
        if(p.sharedAppearance)p.appearanceWarnings.push("Community-approved edits override the baseline.");
      }else if(p.sharedAppearance){
        p.appearanceWarnings=["Using community-approved appearance edits. Anyone can submit edits; please review."];
      }else{
        p.appearanceWarnings=["Features without a saved appearance are placeholders; please review."];
      }
      if(p.sharedAppearanceError)p.appearanceWarnings.push(p.sharedAppearanceError);
      if(p.importedRosterError)p.appearanceWarnings.push(p.importedRosterError);
      playersDone++;report();
    }
  };
  await Promise.all([proPromise,statsPromise,...Array.from({length:Math.min(6,queue.length)},worker)]);
};
window.__HOOPLAND_RESOLVE_LOCATION=function(player){
  const records=window.__HOOPLAND_LOCATION_RECORDS||[];
  if(!records.length)throw new Error("Location catalog is unavailable. Reload the app and try again.");
  const normalize=window.__HOOPLAND_NORMALIZE_LOCATION_NAME;
  const regionName=code=>{
    const overrides={BA:"Bosnia and Herzegovina",HK:"Hong Kong",PS:"Palestine",TT:"Trinidad and Tobago",TR:"Turkey"};
    return overrides[code]||(/^[A-Z]{2}$/.test(code)?new Intl.DisplayNames(["en"],{type:"region"}).of(code==="UK"?"GB":code):"");
  };
  if(!player||!player.isReal){
    const code=String(player&&player.ctry||"").toUpperCase();
    const fictionalCountry=regionName(code);
    const sameCountry=fictionalCountry?records.filter(record=>normalize(record.country)===normalize(fictionalCountry)):[];
    const pool=sameCountry.length?sameCountry:records;
    const fictionalLocation=pool[Math.floor(Math.random()*pool.length)];
    return {home:"",loc:{x:fictionalLocation.x,y:fictionalLocation.y}};
  }

  const fullName=[player.fn,player.ln].filter(Boolean).join(" ");
  const known=window.__HOOPLAND_REAL_PLAYER_HOMETOWNS[normalize(fullName)];
  const home=known&&known.home?known.home:String(player.home||"").trim();
  const code=String(player.ctry||"").toUpperCase();
  const countryName=regionName(code);
  const country=(known&&known.country)||player.homeCountry||countryName||String(player.ctry||"");
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
  throw new Error("Location catalog is unavailable. Reload the app and try again.");
};
</script>`;
}

async function addLocationAssignment(request, env) {
  const pageResponse = await env.ASSETS.fetch(request);
  if (!pageResponse.ok) return pageResponse;

  const catalogURL = new URL("/data/location-catalog.csv", request.url);
  const catalogResponse = await env.ASSETS.fetch(new Request(catalogURL));
  if (!catalogResponse.ok) return new Response("Location catalog could not be loaded.", {status:503});

  const locations = readValidLocations(await catalogResponse.text());
  if (!locations.length) return new Response("Location catalog contains no valid coordinates.", {status:503});

  const originalHtml = await pageResponse.text();
  const transformedHtml = transformGenerator(originalHtml);
  if (!transformedHtml) return new Response("Location assignment could not be initialized.", {status:503});

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
        return handleClassData(request, {
          verifySenior:(player,year)=>verifyWomenDraftSenior(player,year,env),
          rosterCandidates:year=>womenRosterCandidates(env,year)
        });
      }
      const [response, espn] = await Promise.all([
        existingWorker.fetch(request, env, context),
        loadEspnDraftPlayers("women", 2026)
      ]);
      if (!response.ok) return response;
      const body = await response.json();
      if (!Array.isArray(body.players)) return Response.json(body);
      body.players = attachEspnDraftPlayers(body.players, espn.players);
      const filtered = await filterWomenDraftSeniors(body.players, 2026, (player,year)=>verifyWomenDraftSenior(player,year,env));
      body.players = filtered.players;
      body.source = { ...body.source, espnDraft: { status: espn.status, parsed: espn.players.length },
        seniorVerification:{unverified:filtered.unverified,notSenior:filtered.notSenior,foreign:filtered.foreign} };
      if (filtered.unverified) body.warning = `${filtered.unverified} prospect(s) were excluded because their senior status could not be verified.`;
      if (!body.players.length) return Response.json({
        ok:false,error:"No verified senior prospects were available for the 2026 women's draft class.",diagnostics:body.source
      },{status:502});
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      return Response.json(body, { status: response.status, headers });
    }
    if (pathname === "/api/stats") return handleStats(request, env);
    if (pathname === "/api/pro-season") return handleProSeason(request);
    if (pathname === "/api/hometown") return handleHometown(request);
    if (pathname === "/api/shared-appearance") return handleSharedAppearance(request, env);
    if (pathname === "/api/shared-attributes") return handleSharedRatings(request, env);
    if (pathname === "/api/imported-roster") return handleImportedRoster(request, env);
    if (pathname === "/api/appearance-baseline") return handleSharedAppearance(request, env);
    if (pathname === "/" || pathname === "/index.html") {
      return addLocationAssignment(request, env);
    }
    return existingWorker.fetch(request, env, context);
  }
};
