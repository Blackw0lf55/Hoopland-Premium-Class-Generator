const cache = new WeakMap();
const indexes = new WeakMap();

function nameKey(value) {
  const key = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
  return key === "judeawatkins" ? "jujuwatkins" : key;
}

function teamKey(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sameSchool(roster, stats) {
  const school = teamKey(roster), team = teamKey(stats);
  if (!school || !team) return false;
  if (school === "southern cal" && /^(usc|southern california)\b/.test(team)) return true;
  return team === school || team.startsWith(school + " ");
}

async function dataset(env) {
  if (!env?.ASSETS) throw new Error("Women's college roster asset is unavailable.");
  if (!cache.has(env.ASSETS)) {
    const pending = env.ASSETS.fetch(new Request("https://assets.local/data/women-rosters.json"))
      .then(response => {
        if (!response.ok) throw new Error(`Women's college roster asset HTTP ${response.status}`);
        return response.json();
      });
    cache.set(env.ASSETS, pending);
    pending.catch(() => cache.delete(env.ASSETS));
  }
  return cache.get(env.ASSETS);
}

export async function womenRosterSeason(env, year) {
  const data = await dataset(env);
  if (!indexes.has(data)) indexes.set(data,new Map());
  const seasons = indexes.get(data);
  if (seasons.has(year)) return seasons.get(year);
  const rows = data[year];
  if (!Array.isArray(rows)) return null;
  const names = new Map();
  for (const [name, school, grade, jersey, position, country, url] of rows) {
    const key = nameKey(name);
    if (!names.has(key)) names.set(key, []);
    names.get(key).push({name,school,grade,jersey,position,country,url});
  }
  seasons.set(year,names);
  return names;
}

export async function womenRosterLookup(env, year, player) {
  const names = await womenRosterSeason(env, year);
  if (!names) return null;
  const matches = names.get(nameKey([player.fn,player.ln].filter(Boolean).join(" "))) || [];
  return matches.length === 1 ? matches[0] : null;
}

export async function womenRosterCandidates(env, year) {
  const names = await womenRosterSeason(env, year);
  if (!names) return null;
  const response = await env.ASSETS.fetch(new Request("https://assets.local/data/college-women.json"));
  if (!response.ok) throw new Error(`Women's college statistics asset HTTP ${response.status}`);
  const stats = (await response.json())[year];
  if (!Array.isArray(stats)) return [];
  const byName = new Map();
  for (const row of stats) {
    const key = nameKey(row.n);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(row);
  }
  const candidates = [];
  for (const [key, rows] of names) {
    if (rows.length !== 1 || !/^senior$/i.test(rows[0].grade)) continue;
    const roster = rows[0], matches = (byName.get(key) || []).filter(row => sameSchool(roster.school,row.t));
    if (matches.length !== 1) continue;
    const parts = roster.name.trim().split(/\s+/);
    if (parts.length < 2) continue;
    candidates.push({
      fn:parts[0],ln:parts.slice(1).join(" "),position:roster.position,
      school:roster.school,committedCollege:roster.school,jersey:roster.jersey,
      country:roster.country || "United States",rosterMinutes:Number(matches[0].m) * Number(matches[0].g)
    });
  }
  return candidates.sort((a,b)=>b.rosterMinutes-a.rosterMinutes || a.ln.localeCompare(b.ln));
}
