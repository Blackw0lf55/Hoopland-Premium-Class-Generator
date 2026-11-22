const seasonCache = new Map();
const CACHE_MS = 24 * 60 * 60 * 1000;

export function lastCompletedSeason(gender, now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return gender === "women" ? year - (month < 10 ? 1 : 0) : year - (month < 7 ? 1 : 0);
}

export function professionalSeasonRows(data, gender, year = 2020) {
  const set = data?.resultSets?.find(item => item.name === "LeagueDashPlayerStats");
  if (!Array.isArray(set?.headers) || !Array.isArray(set?.rowSet)) throw new Error("Missing NBA advanced statistics");
  const legacy = gender === "men" && year < 1997;
  const names = legacy
    ? ["PLAYER_ID", "PLAYER_NAME", "MIN", "PTS", "FGM", "FGA", "FTM", "FTA", "REB", "AST", "PF", "OREB", "DREB", "STL", "BLK", "TOV"]
    : ["PLAYER_ID", "PLAYER_NAME", "MIN", "PIE"];
  const columns = names.map(name => set.headers.indexOf(name));
  if (columns.some(index => index < 0)) throw new Error("Incomplete NBA advanced statistics");
  const teamColumn = set.headers.indexOf("TEAM_ID");
  const abbreviationColumn = set.headers.indexOf("TEAM_ABBREVIATION");
  const ageColumn = set.headers.indexOf("AGE");
  const minimumMinutes = gender === "women" ? 200 : 400;
  const byId = new Map();
  for (const row of set.rowSet) {
    const values = columns.map(index => row[index]);
    const [rawId, name, rawMinutes] = values;
    const id = String(rawId || "");
    const minutes = Number(rawMinutes);
    let impact;
    if (legacy) {
      if (values.slice(3, 11).some(value => value == null || value === "" || !Number.isFinite(Number(value)))) continue;
      const [pts, fgm, fga, ftm, fta, reb, ast, pf, oreb, dreb, stl, blk, tov] = values.slice(3).map(Number);
      if (year >= 1974 && values.slice(11, 15).some(value => value == null || value === "" || !Number.isFinite(Number(value)))) continue;
      if (year >= 1978 && (values[15] == null || values[15] === "" || !Number.isFinite(tov))) continue;
      impact = 36 * (pts + .4 * fgm - .7 * fga - .4 * (fta - ftm) +
        (year < 1974 ? .3 * reb : .7 * oreb + .3 * dreb + stl + .7 * blk) +
        .7 * ast - .4 * pf - (year < 1978 ? 0 : tov)) / minutes;
    } else {
      if (values[3] == null || values[3] === "") continue;
      impact = Number(values[3]);
    }
    if (!/^\d+$/.test(id) || typeof name !== "string" || !name.trim() ||
        rawMinutes == null || !Number.isFinite(minutes) || minutes <= 0 ||
        !Number.isFinite(impact) || (!legacy && (impact < -1 || impact > 1))) continue;
    const team = teamColumn >= 0 ? String(row[teamColumn] ?? "") : "";
    const abbreviation = abbreviationColumn >= 0 ? String(row[abbreviationColumn] || "").toUpperCase() : "";
    const total = team === "0" || /^(TOT|\d+TM)$/.test(abbreviation);
    const rawAge = ageColumn >= 0 ? row[ageColumn] : null;
    const age = rawAge !== null && rawAge !== "" && Number.isInteger(Number(rawAge)) &&
      Number(rawAge) >= 18 && Number(rawAge) <= 50 ? Number(rawAge) : undefined;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push({ id, name, minutes, impact, team, total, age });
  }
  const rows = [];
  for (const entries of byId.values()) {
    const totals = entries.filter(row => row.total);
    let player;
    if (entries.length === 1) player = entries[0];
    else if (totals.length === 1) player = totals[0];
    else if (!totals.length && entries.every(row => row.team) &&
      new Set(entries.map(row => row.team)).size === entries.length &&
      new Set(entries.map(row => row.name)).size === 1) {
      const minutes = entries.reduce((sum, row) => sum + row.minutes, 0);
      player = { ...entries[0], minutes,
        age:entries.every(row => row.age === entries[0].age) ? entries[0].age : undefined,
        impact:entries.reduce((sum, row) => sum + row.impact * row.minutes, 0) / minutes };
    }
    if (player) rows.push(player);
  }
  const reference = rows.filter(row => row.minutes >= minimumMinutes).sort((a, b) => a.impact - b.impact);
  if (reference.length < 10) throw new Error("Insufficient NBA season data");
  return rows.map(row => {
    const lower = reference.filter(item => item.impact < row.impact).length;
    const equal = reference.filter(item => item.impact === row.impact).length;
    const raw = Math.max(0, Math.min(1, (lower + (equal - 1) / 2) / (reference.length - 1)));
    const confidence = Math.min(1, row.minutes / minimumMinutes);
    return { id:row.id, name:row.name, minutes:row.minutes, impact:row.impact,
      ...(row.age !== undefined ? {age:row.age} : {}),
      percentile: raw * confidence + .1 * (1 - confidence) };
  });
}

export async function handleProSeason(request) {
  const params = new URL(request.url).searchParams;
  const gender = params.get("gender") === "women" ? "women" : "men";
  const year = Number(params.get("year"));
  if (!Number.isInteger(year) || year < (gender === "women" ? 1997 : 1947) || year > lastCompletedSeason(gender)) {
    return Response.json({ ok: false, error: "Unsupported or incomplete professional season." }, { status: 400 });
  }
  const key = `${gender}:${year}`;
  let entry = seasonCache.get(key);
  if (!entry || entry.expires <= Date.now()) {
    const season = gender === "women" ? String(year) : `${year - 1}-${String(year).slice(-2)}`;
    const query = new URLSearchParams({
      College:"", Conference:"", Country:"", DateFrom:"", DateTo:"", Division:"",
      DraftPick:"", DraftYear:"", GameScope:"", GameSegment:"", Height:"",
      LastNGames:"0", LeagueID:gender === "women" ? "10" : "00", Location:"",
      MeasureType:gender === "men" && year < 1997 ? "Base" : "Advanced", Month:"0", OpponentTeamID:"0", Outcome:"",
      PORound:"", PaceAdjust:"N", PerMode:"Totals", Period:"0", PlayerExperience:"",
      PlayerPosition:"", PlusMinus:"N", Rank:"N", Season:season, SeasonSegment:"",
      SeasonType:"Regular Season", ShotClockRange:"", StarterBench:"", TeamID:"0",
      TwoWay:"", VsConference:"", VsDivision:"", Weight:""
    });
    try {
      const response = await fetch(`https://stats.nba.com/stats/leaguedashplayerstats?${query}`, {
        headers: { "User-Agent":"Mozilla/5.0 (compatible; Hoopland-Class-Generator/1.0)",
          Referer:"https://www.nba.com/", Origin:"https://www.nba.com", Accept:"application/json" },
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw new Error(`NBA statistics HTTP ${response.status}`);
      const data = await response.json();
      if (data.parameters?.Season && String(data.parameters.Season) !== season) throw new Error("NBA season mismatch");
      if (data.parameters?.LeagueID && String(data.parameters.LeagueID) !== (gender === "women" ? "10" : "00")) {
        throw new Error("NBA league mismatch");
      }
      entry = { rows: professionalSeasonRows(data, gender, year), expires: Date.now() + CACHE_MS };
      seasonCache.set(key, entry);
    } catch (error) {
      console.warn("Professional stats unavailable", gender, year, error);
      return Response.json({ ok:false, error:"Professional season statistics unavailable." }, {
        status:502, headers:{ "cache-control":"no-store" }
      });
    }
  }
  return Response.json({ ok:true, gender, year, metric:gender === "men" && year < 1997 ? "box-score" : "PIE", rows:entry.rows }, {
    headers:{ "cache-control":"public, max-age=86400" }
  });
}
