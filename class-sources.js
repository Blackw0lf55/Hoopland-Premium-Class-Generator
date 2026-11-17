const UA = "Mozilla/5.0 (compatible; Hoopland-Class-Generator/1.0)";

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
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/json" }
  });

  return {
    ok: response.ok,
    status: response.status,
    text: response.ok ? await response.text() : ""
  };
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
    for (const row of rows) {
      if (row.some(cell => cell.header)) {
        continue;
      }

      const nameCell = row.find(cell => /recruiting\/player|\/player\//i.test(cell.html));

      if (!nameCell) {
        continue;
      }

      const name = splitName(nameCell.text);
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

      players.push({
        ...name,
        rank,
        position: positionCell || "",
        height: heightCell ? heightInches(heightCell) : null,
        stars: gradeCell ? Number(gradeCell) : (starMatches > 0 ? Math.min(5, starMatches) : null),
        school: "",
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
      players.forEach((player, index) => { player.sourceOrder = index; });

      return { players, diagnostics: { attempts } };
    }
  }

  const roster = await loadMcDonaldsRoster(gender, year);

  attempts.push({ source: "McDonald's All-American", parsed: roster.length });
  roster.forEach((player, index) => {
    player.rank = index + 1;
    player.sourceOrder = index;
  });

  return { players: roster, diagnostics: { attempts } };
}

function nameKey(player) {
  return `${player.fn} ${player.ln}`.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}

async function loadProjectedDraft(gender, year) {
  const weights = { 1: 1, 2: 1.5, 3: 2, 4: 2.5 };
  const pool = [];
  const diagnostics = [];

  for (const back of [1, 2, 3, 4]) {
    const loaded = await loadFreshmen(gender, year - back);

    diagnostics.push({ classYear: year - back, parsed: loaded.players.length });

    for (const player of loaded.players) {
      pool.push({ ...player, projectedScore: player.rank * weights[back] });
    }
  }

  const drafted = new Set();
  const nowYear = new Date().getFullYear();
  const draftYears = [];

  for (let y = Math.max(1947, year - 7); y <= Math.min(year - 1, nowYear); y++) {
    draftYears.push(y);
  }

  const pastDrafts = await Promise.all(
    draftYears.map(async y => {
      const [wiki, nba] = await Promise.all([loadWikipediaDraft(gender, y), loadNbaComDraft(gender, y)]);
      return [...wiki.players, ...nba.players];
    })
  );

  for (const list of pastDrafts) {
    for (const player of list) {
      drafted.add(nameKey(player));
    }
  }

  diagnostics.push({ excludedAlreadyDrafted: drafted.size });

  const seen = new Set();
  const players = pool
    .filter(player => !drafted.has(nameKey(player)))
    .sort((a, b) => a.projectedScore - b.projectedScore)
    .filter(player => {
      const key = `${player.fn} ${player.ln}`.toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    })
    .map((player, index) => ({ ...player, projectedPick: index + 1, sourceOrder: index }));

  return { players, diagnostics: { projected: true, classes: diagnostics } };
}

export async function handleClassData(request) {
  const url = new URL(request.url);
  const gender = url.searchParams.get("gender") === "women" ? "women" : "men";
  const type = url.searchParams.get("type") === "freshman" ? "freshman" : "draft";
  const year = Number(url.searchParams.get("year"));

  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return Response.json({ ok: false, error: "Invalid year." }, { status: 400 });
  }

  let loaded;

  if (type === "draft") {
    loaded = await loadWikipediaDraft(gender, year);

    const nba = await loadNbaComDraft(gender, year);

    loaded.diagnostics.nbaCom = { status: nba.status, parsed: nba.players.length };

    if (nba.players.length) {
      loaded.players = mergeDraftSources(loaded.players, nba.players);
    }

    if (!loaded.players.length && year >= new Date().getFullYear()) {
      loaded = await loadProjectedDraft(gender, year);
    }
  }
  else {
    loaded = await loadFreshmen(gender, year);
  }

  if (!loaded.players.length) {
    return Response.json(
      {
        ok: false,
        error: `No ${year} ${gender} ${type} class could be loaded.`,
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
    players
  });
}

export { parseTables, parseEspnRecruits };
