const UA = "Mozilla/5.0 (compatible; Hoopland-Class-Generator/1.0; +https://github.com/Blackw0lf55/Hoopland-Premium-Class-Generator)";

const decode = text =>
  String(text || "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

const stripTags = html =>
  decode(
    String(html || "")
      .replace(/<sup[\s\S]*?<\/sup>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();

function parseTables(html) {
  const tables = [];
  const tablePattern = /<table[\s\S]*?<\/table>/gi;
  let tableMatch;

  while ((tableMatch = tablePattern.exec(html))) {
    const rows = [];
    const rowPattern = /<tr[\s\S]*?<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowPattern.exec(tableMatch[0]))) {
      const cells = [];
      const cellPattern = /<t([hd])([^>]*)>([\s\S]*?)<\/t[hd]>/gi;
      let cellMatch;

      while ((cellMatch = cellPattern.exec(rowMatch[0]))) {
        const raw = cellMatch[3];
        const titles = [...raw.matchAll(/title="([^"]+)"/gi)].map(m => decode(m[1]));

        cells.push({
          header: cellMatch[1].toLowerCase() === "h",
          html: raw,
          text: stripTags(raw),
          titles
        });
      }

      if (cells.length) {
        rows.push(cells);
      }
    }

    tables.push(rows);
  }

  return tables;
}

function splitName(fullName) {
  const name = fullName
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[†‡*^~#§¶∗]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const suffix = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
  const parts = name.split(" ").filter(Boolean);

  while (parts.length > 2 && suffix.test(parts[parts.length - 1])) {
    parts.pop();
  }

  if (parts.length < 2) {
    return null;
  }

  let i = parts.length - 1;

  while (i > 1 && /^(van|von|de|del|della|di|da|la|le|st\.?|bin|al|el)$/i.test(parts[i - 1])) {
    i--;
  }

  return { fn: parts[0], ln: parts.slice(i).join(" ") };
}

function heightInches(text) {
  const match = String(text || "").match(/(\d)\s*(?:-|'|ft)\s*(\d{1,2})/);

  return match
    ? Number(match[1]) * 12 + Number(match[2])
    : null;
}

function normalizeCountry(cell) {
  if (!cell) {
    return "United States";
  }

  const candidate = cell.text || cell.titles[0] || "";

  return candidate || "United States";
}

async function fetchText(url) {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/json" }
    });
    return {
      ok: response.ok,
      status: response.status,
      text: response.ok ? await response.text() : ""
    };
  } catch (error) {
    console.warn("Class source request failed", url, error);
    return { ok:false, status:0, text:"" };
  }
}

async function loadWikipediaDraft(gender, year) {
  const league = gender === "women" ? "WNBA" : year <= 1949 ? "BAA" : "NBA";
  const page = `${year}_${league}_draft`;
  const url =
    "https://en.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2" +
    `&prop=text&redirects=1&page=${encodeURIComponent(page)}`;

  const result = await fetchText(url);

  if (!result.ok) {
    return { players: [], diagnostics: { page, status: result.status } };
  }

  let html = "";

  try {
    html = JSON.parse(result.text).parse.text || "";
  }
  catch {
    return { players: [], diagnostics: { page, error: "bad json" } };
  }

  const players = [];
  const seen = new Set();
  let roundNumber = 0;

  for (const rows of parseTables(html)) {
    const headerRow = rows.find(row => row.some(cell => cell.header));

    if (!headerRow) {
      continue;
    }

    const headers = headerRow.map(cell => cell.text.toLowerCase());
    const column = pattern => headers.findIndex(header => pattern.test(header));
    const pickColumn = column(/^pick|^no\.|^#/);
    const playerColumn = column(/^player/);

    if (pickColumn < 0 || playerColumn < 0) {
      continue;
    }

    roundNumber += 1;

    const roundColumn = column(/^rd|^round/);
    const positionColumn = column(/^pos/);
    const nationalityColumn = column(/^nationality|^country/);
    const teamColumn = column(/^(team|nba team|wnba team)/);
    const schoolColumn = column(/^school|^college|^club/);
    const hometownColumn = column(/^home\s*town$/);
    const birthplaceColumn = column(/^(?:birth\s*place|place of birth)$/);

    for (const row of rows) {
      if (row === headerRow || row.length < headers.length - 1) {
        continue;
      }

      const pick = Number(String(row[pickColumn]?.text || "").replace(/\D/g, ""));
      const name = row[playerColumn] ? splitName(row[playerColumn].text) : null;

      if (!pick || !name || seen.has(pick)) {
        continue;
      }

      seen.add(pick);

      const round = roundColumn >= 0
        ? Number(String(row[roundColumn]?.text || "").replace(/\D/g, "")) || roundNumber
        : roundNumber;

      players.push({
        ...name,
        position: positionColumn >= 0 ? row[positionColumn]?.text || "" : "",
        team: teamColumn >= 0 ? row[teamColumn]?.text || "" : "",
        school: schoolColumn >= 0 ? row[schoolColumn]?.text || "" : "",
        hometown: hometownColumn >= 0 ? row[hometownColumn]?.text || "" : "",
        birthplace: birthplaceColumn >= 0 ? row[birthplaceColumn]?.text || "" : "",
        country: normalizeCountry(nationalityColumn >= 0 ? row[nationalityColumn] : null),
        draftPick: pick,
        draftRound: round
      });
    }
  }

  return { players, diagnostics: { page, status: result.status, parsed: players.length } };
}

async function loadNbaComDraft(gender, year) {
  const leagueId = gender === "women" ? "10" : "00";
  const season = gender === "women" ? String(year) : String(year);
  const url =
    `https://stats.nba.com/stats/drafthistory?LeagueID=${leagueId}&Season=${season}`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Referer: "https://www.nba.com/",
        Origin: "https://www.nba.com",
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      return { players: [], status: response.status };
    }

    const data = await response.json();
    const set = (data.resultSets || [])[0];

    if (!set) {
      return { players: [], status: 200 };
    }

    const column = name => set.headers.indexOf(name);
    const players = [];

    for (const row of set.rowSet || []) {
      const name = splitName(String(row[column("PLAYER_NAME")] || ""));
      const pick = Number(row[column("OVERALL_PICK")]);

      if (!name || !pick) {
        continue;
      }

      const personId = row[column("PERSON_ID")];

      players.push({
        ...name,
        draftPick: pick,
        draftRound: Number(row[column("ROUND_NUMBER")]) || 1,
        roundPick: Number(row[column("ROUND_PICK")]) || null,
        team: [row[column("TEAM_CITY")], row[column("TEAM_NAME")]].filter(Boolean).join(" "),
        school: row[column("ORGANIZATION")] || "",
        proId: /^\d+$/.test(String(personId || "")) ? String(personId) : undefined,
        headshot: personId
          ? `https://cdn.nba.com/headshots/${gender === "women" ? "wnba" : "nba"}/latest/1040x760/${personId}.png`
          : undefined,
        country: "United States"
      });
    }

    return { players, status: 200 };
  }
  catch (error) {
    return { players: [], status: 0 };
  }
}

function mergeDraftSources(wikipedia, nba) {
  const byPick = new Map(wikipedia.map(player => [player.draftPick, player]));
  const merged = [];

  for (const player of nba) {
    const other = byPick.get(player.draftPick);

    byPick.delete(player.draftPick);
    merged.push(other
      ? { ...other, ...Object.fromEntries(Object.entries(player).filter(([, value]) => value)), position: other.position, country: other.country }
      : player);
  }

  return merged.concat([...byPick.values()]).sort((a, b) => a.draftPick - b.draftPick);
}

async function loadMcDonaldsRoster(gender, year) {
  const side = gender === "women" ? "Girls" : "Boys";
  const page = `${year}_McDonald's_All-American_${side}_Game`;
  const url =
    "https://en.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2" +
    `&prop=text&redirects=1&page=${encodeURIComponent(page)}`;
  const result = await fetchText(url);

  if (!result.ok) {
    return [];
  }

  let html = "";

  try {
    html = JSON.parse(result.text).parse.text || "";
  }
  catch {
    return [];
  }

  const players = [];
  const seen = new Set();

  for (const rows of parseTables(html)) {
    const headerRow = rows.find(row => row.some(cell => cell.header)) || rows[0];
    const headers = headerRow.map(cell => cell.text.toLowerCase());
    const column = pattern => headers.findIndex(header => pattern.test(header));
    const nameColumn = column(/^(player|name)/);

    if (nameColumn < 0) {
      continue;
    }

    const positionColumn = column(/^pos/);
    const heightColumn = column(/^(ht|height)/);
    const schoolColumn = column(/^(school|high school)/);
    const collegeColumn = column(/^(college|commitment|committed|college choice)$/);
    const hometownColumn = column(/^home\s*town$/);
    const birthplaceColumn = column(/^(?:birth\s*place|place of birth)$/);

    for (const row of rows) {
      if (row === headerRow) {
        continue;
      }

      const name = row[nameColumn] ? splitName(row[nameColumn].text) : null;
      const key = name ? `${name.fn} ${name.ln}`.toLowerCase() : "";

      if (!name || seen.has(key)) {
        continue;
      }

      seen.add(key);
      players.push({
        ...name,
        position: positionColumn >= 0 ? row[positionColumn]?.text || "" : "",
        height: heightColumn >= 0 ? heightInches(row[heightColumn]?.text) : null,
        school: schoolColumn >= 0 ? row[schoolColumn]?.text || "" : "",
        committedCollege: collegeColumn >= 0 ? row[collegeColumn]?.text || "" : "",
        hometown: hometownColumn >= 0 ? row[hometownColumn]?.text || "" : "",
        birthplace: birthplaceColumn >= 0 ? row[birthplaceColumn]?.text || "" : "",
        country: "United States"
      });
    }
  }

  return players;
}

function espnRankingUrls(gender, year) {
  if (gender === "women") {
    return [
      `https://www.espn.com/college-sports/womens-basketball/recruiting/rankings/scnext300girls/_/class/${year}`,
      `https://www.espn.com/college-sports/womens-basketball/recruiting/rankings/scnext100girls/_/class/${year}`,
      `https://www.espn.com/college-sports/womens-basketball/recruiting/rankings/scnext300/_/class/${year}`
    ];
  }

  return [
    `https://www.espn.com/college-sports/basketball/recruiting/rankings/scnext300boys/_/class/${year}`,
    `https://www.espn.com/college-sports/basketball/recruiting/rankings/scnext100boys/_/class/${year}`,
    `https://www.espn.com/college-sports/basketball/recruiting/rankings/scnext300/_/class/${year}`
  ];
}

function parseEspnRecruits(html) {
  const players = [];
  const seen = new Set();

  for (const rows of parseTables(html)) {
    const header = rows.find(row => row.some(cell => cell.header));
    const commitmentColumn = header ? header.findIndex(cell => /^(college|commitment|committed|college choice)$/i.test(cell.text)) : -1;
    const hometownColumn = header ? header.findIndex(cell => /^home\s*town$/i.test(cell.text)) : -1;
    const birthplaceColumn = header ? header.findIndex(cell => /^(?:birth\s*place|place of birth)$/i.test(cell.text)) : -1;
    for (const row of rows) {
      if (row.some(cell => cell.header)) {
        continue;
      }

      const nameCell = row.find(cell => /recruiting\/player|\/player\//i.test(cell.html));

      if (!nameCell) {
        continue;
      }

      const names = [...nameCell.html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)]
        .filter(match => /href\s*=\s*["'][^"']*(?:recruiting\/player|\/player\/)[^"']*["']/i.test(match[1]))
        .map(match => stripTags(match[2]).replace(/\b(?:video|scouts?\s+report)\b.*$/i, "").replace(/[|]/g, "").trim())
        .filter(text => text && splitName(text));
      const distinctNames = [...new Set(names)];
      const name = distinctNames.length === 1 ? splitName(distinctNames[0]) : null;
      const rank = Number((row[0]?.text || "").replace(/\D/g, ""));

      if (!name || !rank || seen.has(rank)) {
        continue;
      }

      seen.add(rank);

      const texts = row.map(cell => cell.text);
      const heightCell = texts.find(text => /^\d\s*-\s*\d{1,2}$/.test(text));
      const positionCell = texts.find(text => /^(PG|SG|SF|PF|C|G|F|CG|G\/F|F\/C)$/i.test(text));
      const gradeCell = texts.find(text => /^\d{2,3}$/.test(text) && Number(text) >= 60 && Number(text) <= 100 && text !== String(rank));
      const starMatches = row.reduce((total, cell) => total + (cell.html.match(/star/gi) || []).length, 0);
      const schoolCells = row.filter(cell => /recruiting\/school\/_\/id\/\d+/i.test(cell.html));
      const schoolCell = schoolCells[0] ||
        (commitmentColumn >= 0 ? row[commitmentColumn] : null);
      const schoolIds = [...new Set(schoolCells.flatMap(cell =>
        [...cell.html.matchAll(/recruiting\/school\/_\/id\/(\d+)/gi)].map(match => match[1])))];

      players.push({
        ...name,
        rank,
        position: positionCell || "",
        height: heightCell ? heightInches(heightCell) : null,
        stars: gradeCell ? Number(gradeCell) : (starMatches > 0 ? Math.min(5, starMatches) : null),
        school: schoolCell?.text || "",
        committedCollege: schoolIds.length > 1 ? "" : schoolCell?.text || "",
        collegeTeamId: schoolIds.length === 1 ? schoolIds[0] : undefined,
        hometown: hometownColumn >= 0 ? row[hometownColumn]?.text || "" : "",
        birthplace: birthplaceColumn >= 0 ? row[birthplaceColumn]?.text || "" : "",
        country: "United States"
      });
    }
  }

  return players;
}

async function loadFreshmen(gender, year) {
  const attempts = [];

  for (const url of espnRankingUrls(gender, year)) {
    const result = await fetchText(url);
    const players = result.ok ? parseEspnRecruits(result.text) : [];

    attempts.push({ url, status: result.status, parsed: players.length });

    if (players.length) {
      players.sort((a, b) => a.rank - b.rank);
      players.forEach((player, index) => { player.sourceOrder = index; player.recruitYear = year; });

      return { players, diagnostics: { attempts } };
    }
  }

  const roster = await loadMcDonaldsRoster(gender, year);

  attempts.push({ source: "McDonald's All-American", parsed: roster.length });
  roster.forEach((player, index) => {
    player.rank = index + 1;
    player.sourceOrder = index;
    player.recruitYear = year;
  });

  return { players: roster, diagnostics: { attempts } };
}

function nameKey(player) {
  return `${player.fn} ${player.ln}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}

function exclusionNameKey(player) {
  const key = `${player.fn} ${player.ln}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
  return key === "judeawatkins" ? "jujuwatkins" : key;
}

// Both schools identify these players as seniors in the 2026–27 season.
const WOMEN_2027_PROSPECTS = [
  {fn:"JuJu",ln:"Watkins",position:"G",school:"USC",committedCollege:"USC",collegeTeamId:"30",jersey:"12",
    seniorSource:"https://usctrojans.com/sports/womens-basketball/roster/watkins-juju/18627"},
  {fn:"Hannah",ln:"Hidalgo",position:"PG",school:"Notre Dame",committedCollege:"Notre Dame",collegeTeamId:"87",jersey:"3",
    seniorSource:"https://fightingirish.com/sports/wbball/roster/season/2026-27"}
];

const domesticRegions = new Set(["US","PR","VI","GU","AS","MP","UM"]);
const foreignRegions = (() => {
  const names = new Intl.DisplayNames(["en"],{type:"region"});
  const regions = new Set();
  for (let first=65;first<=90;first++) for (let second=65;second<=90;second++) {
    const code=String.fromCharCode(first,second);
    if (domesticRegions.has(code) || code==="ZZ") continue;
    const name=names.of(code);
    if (name && name!==code && name!=="Unknown Region") {
      regions.add(code.toLowerCase());
      regions.add(name.toLowerCase());
    }
  }
  return regions;
})();

export async function filterWomenDraftSeniors(players, year, verifySenior) {
  let next = 0, unverified = 0, notSenior = 0, foreign = 0;
  const results = new Array(players.length);
  const inspect = async () => {
    while (next < players.length) {
      const index = next++;
      const player = players[index];
      const curated = year === 2027 && WOMEN_2027_PROSPECTS.some(candidate =>
        exclusionNameKey(candidate) === exclusionNameKey(player));
      const international = foreignRegions.has(String(player.country || "").trim().toLowerCase());
      if (international) { results[index] = player; foreign++; continue; }
      let verified = curated ? true : null;
      if (typeof verifySenior === "function") {
        try {
          const result = await verifySenior(player, year);
          if (!curated) verified = result;
        } catch (error) {
          console.warn("Women's senior verification failed", player.fn, player.ln, error);
        }
      }
      if (verified === true) results[index] = player;
      else if (verified === false) notSenior++;
      else unverified++;
    }
  };
  await Promise.all(Array.from({length:Math.min(8,players.length)},inspect));
  return {players:results.filter(Boolean),unverified,notSenior,foreign};
}

async function loadEspnDraftHistory(gender, year) {
  const league = gender === "women" ? "wnba" : "nba";
  try {
    const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/${league}/draft?season=${year}`,
      { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!response.ok) return { players: [], status: response.status, verified: false };
    const data = await response.json();
    const season = Number(String(data?.displayName || "").match(/\b(?:19|20)\d{2}\b/)?.[0] || data?.season?.year);
    if (season !== year || !Array.isArray(data.picks) || !data.picks.length) {
      return { players: [], status: response.status, verified: false };
    }
    const selected = data.picks.filter(pick => pick.status === "SELECTION_MADE");
    const players = selected.map(pick => splitName(String(pick.athlete?.displayName || "")));
    const pending = data.picks.every(pick => pick.status === "PENDING");
    return {
      players: players.filter(Boolean),
      status: response.status,
      verified: (selected.length === data.picks.length && selected.length > 0 && players.every(Boolean)) ||
        (year === new Date().getFullYear() && pending)
    };
  } catch (error) {
    console.warn("ESPN draft history lookup failed", gender, year, error);
    return { players: [], status: 0, verified: false };
  }
}

async function loadCurrentNbaPlayers() {
  const now = new Date();
  const start = now.getUTCFullYear() - (now.getUTCMonth() < 6 ? 1 : 0);
  const season = `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
  const url = `https://stats.nba.com/stats/commonallplayers?LeagueID=00&Season=${season}&IsOnlyCurrentSeason=1`;
  try {
    const response = await fetch(url, { headers: {
      "User-Agent": UA, Referer: "https://www.nba.com/", Origin: "https://www.nba.com/", Accept: "application/json"
    } });
    if (!response.ok) return { players: [], status: response.status, season, verified: false };
    const data = await response.json();
    const set = data.resultSets?.[0];
    const nameColumn = set?.headers?.indexOf("DISPLAY_FIRST_LAST");
    if (!Number.isInteger(nameColumn) || nameColumn < 0 || !Array.isArray(set.rowSet)) {
      return { players: [], status: response.status, season, verified: false };
    }
    const names = set.rowSet.map(row => splitName(String(row[nameColumn] || "")));
    return { players: names.filter(Boolean), status: response.status, season,
      verified: names.length > 0 && names.every(Boolean) };
  } catch (error) {
    console.warn("NBA roster lookup failed", season, error);
    return { players: [], status: 0, season, verified: false };
  }
}

function espnDraftPhotos(data, year) {
  const statedYear = Number(String(data?.displayName || "").match(/\b(?:19|20)\d{2}\b/)?.[0] || data?.season?.year);
  if (statedYear !== year || !Array.isArray(data?.picks)) return [];
  return data.picks.flatMap(pick => {
    const athlete = pick.athlete;
    const name = splitName(String(athlete?.displayName || ""));
    const headshot = athlete?.headshot?.href;
    if (!name || pick.status !== "SELECTION_MADE" || typeof headshot !== "string") return [];
    try {
      const url = new URL(headshot);
      if (url.protocol !== "https:" || url.hostname !== "a.espncdn.com") return [];
    } catch (error) {
      return [];
    }
    const espnId = /^\d{1,10}$/.test(String(athlete.id || "")) ? String(athlete.id) : undefined;
    return [{ ...name, draftPick: Number(pick.overall) || 0, headshot, espnId }];
  });
}

async function loadEspnDraftPhotos(gender, year) {
  const league = gender === "women" ? "wnba" : "nba";
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/${league}/draft?season=${year}`;
  try {
    const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!response.ok) return { players: [], status: response.status };
    return { players: espnDraftPhotos(await response.json(), year), status: response.status };
  } catch (error) {
    console.warn("ESPN draft photo lookup failed", gender, year, error);
    return { players: [], status: 0 };
  }
}

function attachEspnDraftPhotos(players, photos) {
  const photoKey = player => {
    const key = nameKey(player);
    return key === "awa thiam" || key === "awa fam thiam" ? "awa fam" : key;
  };
  const byName = new Map();
  for (const photo of photos) {
    const key = photoKey(photo);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(photo);
  }
  return players.map(player => {
    const matches = byName.get(photoKey(player)) || [];
    const match = matches.length === 1 ? matches[0] : null;
    if (!match || (player.draftPick && match.draftPick && Number(player.draftPick) !== match.draftPick)) return player;
    const existing = Array.isArray(player.headshots) ? player.headshots : [];
    const headshots = [...new Set([player.headshot, ...existing, match.headshot].filter(Boolean))];
    return { ...player, headshots, ...(match.espnId ? { espnId: match.espnId } : {}) };
  });
}

async function loadProjectedDraft(gender, year, options = {}) {
  const weights = { 1: 1, 2: 1.5, 3: 2, 4: 2.5 };
  const pool = [];
  const diagnostics = [];

  const recruitingYears = gender === "women" ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4];
  const classes = await Promise.all(recruitingYears.map(back => loadFreshmen(gender, year - back)));
  for (const [index, back] of recruitingYears.entries()) {
    const loaded = classes[index];

    diagnostics.push({ classYear: year - back, parsed: loaded.players.length });

    for (const player of loaded.players) {
      pool.push({ ...player, projectedScore: player.rank * (weights[back] || weights[4]) });
    }
  }

  const ineligible = new Set();
  const nowYear = new Date().getFullYear();
  const draftYears = [];

  for (let y = Math.max(1947, year - 4); y <= Math.min(year - 1, nowYear); y++) {
    draftYears.push(y);
  }

  const [pastDrafts, roster] = await Promise.all([
    Promise.all(draftYears.map(async y => {
      const [wiki, nba, espn] = await Promise.all([
        loadWikipediaDraft(gender, y), loadNbaComDraft(gender, y), loadEspnDraftHistory(gender, y)
      ]);
      return { year:y, players:[...wiki.players, ...nba.players, ...espn.players],
        verified:Boolean(wiki.players.length || nba.players.length || espn.verified) };
    })),
    gender === "men" ? loadCurrentNbaPlayers() : Promise.resolve(null)
  ]);

  const missingYears = pastDrafts.filter(draft => !draft.verified).map(draft => draft.year);
  if (missingYears.length && gender !== "women") {
    return { players: [], diagnostics: { projected:true, classes:diagnostics, missingDraftYears:missingYears },
      error: `Cannot verify prior draft results for ${missingYears.join(", ")}. Please try again later.` };
  }
  for (const draft of pastDrafts) {
    for (const player of draft.players) {
      ineligible.add(exclusionNameKey(player));
    }
  }
  for (const player of roster?.players || []) ineligible.add(exclusionNameKey(player));

  if (gender === "women" && year === 2027) {
    const priority = WOMEN_2027_PROSPECTS.map((player,index)=>({
      ...player, recruitYear:2023, country:"United States", projectedScore:index-2
    }));
    pool.unshift(...priority);
  }
  let rosterWarning = "";
  if (gender === "women" && options.rosterCandidates) {
    try {
      const candidates = await options.rosterCandidates(year);
      if (candidates === null) rosterWarning = `School-roster data for ${year} is unavailable.`;
      else {
        diagnostics.push({schoolRosterCandidates:candidates.length});
        candidates.forEach((player,index)=>pool.push({...player,projectedScore:10000+index}));
      }
    } catch (error) {
      console.warn("Women's college roster lookup failed", year, error);
      rosterWarning = "School-roster candidates could not be loaded.";
    }
  }
  diagnostics.push({ priorDraftYears:draftYears, excludedNames:ineligible.size,
    ...(roster ? { nbaRoster:{ season:roster.season, status:roster.status, verified:roster.verified } } : {}) });

  const seen = new Set();
  const players = pool
    .filter(player => !ineligible.has(exclusionNameKey(player)))
    .sort((a, b) => a.projectedScore - b.projectedScore)
    .filter(player => {
      const key = exclusionNameKey(player);

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    })
    .map((player, index) => ({ ...player, projectedPick: index + 1, sourceOrder: index }));

  return { players, diagnostics: { projected: true, classes: diagnostics },
    warning: [
      missingYears.length ? `Prior draft results for ${missingYears.join(", ")} could not be verified; previously drafted players may appear.` : "",
      rosterWarning,
      roster && !roster.verified ? "Current NBA roster could not be verified; undrafted NBA players may appear in this class." : ""
    ].filter(Boolean).join(" ") };
}

export async function handleClassData(request, options = {}) {
  const url = new URL(request.url);
  const gender = url.searchParams.get("gender") === "women" ? "women" : "men";
  const type = url.searchParams.get("type") === "freshman" ? "freshman" : "draft";
  const year = Number(url.searchParams.get("year"));

  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return Response.json({ ok: false, error: "Invalid year." }, { status: 400 });
  }

  let loaded;

  if (type === "draft") {
    const [wikipedia, nba, espn] = await Promise.all([
      loadWikipediaDraft(gender, year),
      loadNbaComDraft(gender, year),
      loadEspnDraftPhotos(gender, year)
    ]);
    loaded = wikipedia;

    loaded.diagnostics.nbaCom = { status: nba.status, parsed: nba.players.length };
    loaded.diagnostics.espnPhotos = { status: espn.status, parsed: espn.players.length };

    if (nba.players.length) {
      loaded.players = mergeDraftSources(loaded.players, nba.players);
    }
    loaded.players = attachEspnDraftPhotos(loaded.players, espn.players);

    if (!loaded.players.length && year >= new Date().getFullYear()) {
      loaded = await loadProjectedDraft(gender, year, options);
    }
  }
  else {
    loaded = await loadFreshmen(gender, year);
  }

  if (gender === "women" && type === "draft" && loaded.players.length) {
    const filtered = await filterWomenDraftSeniors(loaded.players, year, options.verifySenior);
    loaded.players = filtered.players;
    loaded.diagnostics.seniorVerification = {unverified:filtered.unverified,notSenior:filtered.notSenior,foreign:filtered.foreign};
    if (filtered.unverified) loaded.warning = [loaded.warning,
      `${filtered.unverified} prospect(s) were excluded because their senior status could not be verified.`].filter(Boolean).join(" ");
    if (loaded.diagnostics.projected) loaded.players.forEach((player,index)=>{player.projectedPick=index+1;});
    if (!loaded.players.length) loaded.error = `No verified senior prospects were available for the ${year} women's draft class.`;
  }
  if (!loaded.players.length) {
    return Response.json(
      {
        ok: false,
        error: loaded.error || `No ${year} ${gender} ${type} class could be loaded.`,
        diagnostics: loaded.diagnostics
      },
      { status: 502 }
    );
  }

  const players = type === "draft"
    ? loaded.players.slice().sort((a, b) => a.draftPick - b.draftPick)
    : loaded.players;

  return Response.json({
    ok: true,
    request: { gender, type, year: String(year) },
    source: loaded.diagnostics,
    ...(loaded.warning ? { warning:loaded.warning } : {}),
    players
  });
}

export { parseTables, parseEspnRecruits, espnDraftPhotos, attachEspnDraftPhotos, loadEspnDraftPhotos };
