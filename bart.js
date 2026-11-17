const FIRST_SEASON = 2008;

const ERAS = [
  { id: 4, from: 2008, to: 2015, sample: [2009, 2012, 2015] },
  { id: 5, from: 2016, to: 2021, sample: [2016, 2018, 2021] },
  { id: 6, from: 2022, to: 2100, sample: [2022, 2024, 2025] }
];

const LEAGUE = {
  dunk: [0.75, 5],
  c2: [0.58, 20],
  f2: [0.38, 20],
  ft: [0.7, 25],
  tp: [0.34, 30]
};

const ATTR_METRICS = {
  LAY: { c2A: 0.3, c2P: 0.4, ftr: 0.3 },
  DNK: { dunkM: 0.6, dunkA: 0.2, dunkP: 0.2 },
  INS: { c2M: 0.4, c2P: 0.2, ftr: 0.2, or: 0.2 },
  MID: { f2M: 0.4, f2A: 0.3, f2P: 0.3 },
  TPT: { tpM: 0.35, tpA: 0.25, tpP: 0.4 },
  FTS: { ftP: 0.6, ftM: 0.2, ftA: 0.2 },
  DRB: { usg: 0.3, a2o: 0.25, toInv: 0.25, ast: 0.2 },
  PAS: { ast: 0.6, astG: 0.2, a2o: 0.2 },
  ORE: { or: 0.9, reb: 0.1 },
  DRE: { dr: 0.8, reb: 0.2 },
  STL: { stl: 0.85, dprpg: 0.15 },
  BLK: { blk: 0.85, dprpg: 0.15 }
};

const TEND_METRICS = {
  dunk: { dunkShare: 0.6, dunkA: 0.4 },
  floater: { c2Share: 0.5, c2A: 0.3, ftr: 0.2 },
  hook: { c2Share: 0.4, ht: 0.3, or: 0.3 },
  post: { c2Share: 0.4, ht: 0.3, ftr: 0.3 },
  twoPoint: { f2Share: 0.5, f2A: 0.5 },
  threePoint: { tpr: 0.5, tpA: 0.5 },
  pumpFake: { ftr: 0.5, f2Share: 0.25, tpr: 0.25 },
  fades: { f2Share: 0.6, f2A: 0.4 },
  pass: { ast: 0.6, astG: 0.4 },
  lob: { ast: 0.5, ht: 0.25, dunkM: 0.25 },
  cross: { usg: 0.5, ast: 0.3, a2o: 0.2 },
  spin: { usg: 0.5, c2A: 0.3, ftr: 0.2 },
  step: { tpr: 0.4, usg: 0.3, f2Share: 0.3 },
  offReb: { or: 0.85, ht: 0.15 },
  runPlay: { ast: 0.5, a2o: 0.5 },
  defReb: { dr: 0.85, ht: 0.15 },
  takeCharge: { dbpm: 0.5, dr: 0.3, stl: 0.2 },
  stealOnBall: { stl: 0.8, dprpg: 0.2 },
  stealOffBall: { stl: 0.7, dbpm: 0.3 },
  block: { blk: 0.8, ht: 0.2 }
};

const memory = new Map();

export function eraFor(year) {
  return ERAS.find(era => year >= era.from && year <= era.to) || null;
}

function normalizeName(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function text(cell) {
  return cell
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function num(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function madeAttempted(value) {
  const match = String(value || "").match(/(\d+)\s*-\s*(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}

function heightInches(value) {
  const match = String(value || "").match(/(\d)\s*-\s*(\d{1,2})/);
  return match ? Number(match[1]) * 12 + Number(match[2]) : 0;
}

function adjusted(made, attempts, [league, strength]) {
  if (!attempts) {
    return -1;
  }

  return (made + league * strength) / (attempts + strength);
}

function parseSeason(html) {
  const rows = [];
  let yrIndex = 2;
  const trs = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];

  for (const tr of trs) {
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(text);

    if (!cells.length) {
      continue;
    }

    if (cells.includes("Player") && cells.includes("Yr")) {
      yrIndex = cells.indexOf("Yr");
      continue;
    }

    const at = index => cells[yrIndex + index - 2];

    if (cells.length < yrIndex + 51 || !at(4)) {
      continue;
    }

    const games = num(at(8));
    const g = games || 1;
    const dunk = madeAttempted(at(31));
    const close = madeAttempted(at(34));
    const far = madeAttempted(at(37));
    const ft = madeAttempted(at(40));
    const three = madeAttempted(at(47));
    const fga = close[1] + far[1] + three[1];
    const ht = heightInches(at(3));

    rows.push({
      name: at(4),
      team: at(6),
      yr: at(2),
      ht,
      role: at(9),
      g: games,
      min: num(at(10)),
      f: {
        dunkM: dunk[0] / g,
        dunkA: dunk[1] / g,
        dunkP: adjusted(dunk[0], dunk[1], LEAGUE.dunk),
        dunkShare: fga ? dunk[1] / fga : 0,
        c2M: close[0] / g,
        c2A: close[1] / g,
        c2P: adjusted(close[0], close[1], LEAGUE.c2),
        c2Share: fga ? close[1] / fga : 0,
        f2M: far[0] / g,
        f2A: far[1] / g,
        f2P: adjusted(far[0], far[1], LEAGUE.f2),
        f2Share: fga ? far[1] / fga : 0,
        ftM: ft[0] / g,
        ftA: ft[1] / g,
        ftP: adjusted(ft[0], ft[1], LEAGUE.ft),
        tpM: three[0] / g,
        tpA: three[1] / g,
        tpP: adjusted(three[0], three[1], LEAGUE.tp),
        tpr: num(at(45)),
        usg: num(at(18)),
        ast: num(at(23)),
        astG: num(at(50)),
        toInv: -num(at(24)),
        a2o: Math.min(num(at(25)), 6),
        blk: num(at(26)),
        stl: num(at(27)),
        ftr: num(at(28)),
        or: num(at(21)),
        dr: num(at(22)),
        reb: num(at(51)),
        dprpg: num(at(12)),
        dbpm: num(at(15)),
        ht
      }
    });
  }

  return rows;
}

function seasonUrl(year) {
  return (
    "https://barttorvik.com/playerstat.php?link=y&showfull=1" +
    `&year=${year}&start=${year - 1}1015&end=${year}0501`
  );
}

async function cached(key, ttl, build) {
  if (memory.has(key)) {
    return memory.get(key);
  }

  let cache = null;
  const request = new Request(`https://bart.cache/${key}`);

  try {
    cache = caches.default;
    const hit = await cache.match(request);

    if (hit) {
      const value = await hit.json();
      memory.set(key, value);
      return value;
    }
  } catch (error) {
    cache = null;
  }

  const value = await build();

  if (value) {
    memory.set(key, value);

    try {
      if (cache) {
        await cache.put(
          request,
          new Response(JSON.stringify(value), {
            headers: { "Cache-Control": `public, max-age=${ttl}` }
          })
        );
      }
    } catch (error) {
      // Cache is best-effort.
    }
  }

  return value;
}

async function loadSeason(year) {
  const current = new Date().getFullYear() + (new Date().getMonth() >= 9 ? 1 : 0);
  const ttl = year >= current ? 60 * 60 * 12 : 60 * 60 * 24 * 30;

  return cached(`season/${year}`, ttl, async () => {
    const response = await fetch(seasonUrl(year), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HooplandClassGenerator/1.0)" }
    });

    if (!response.ok) {
      return null;
    }

    const rows = parseSeason(await response.text());

    return rows.length ? rows : null;
  });
}

function quantiles(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const steps = 200;

  if (!sorted.length) {
    return Array(steps + 1).fill(0);
  }

  return Array.from({ length: steps + 1 }, (_, i) =>
    sorted[Math.min(sorted.length - 1, Math.round((i / steps) * (sorted.length - 1)))]
  );
}

function percentile(table, value) {
  if (value < 0) {
    return 0;
  }

  if (value <= table[0]) {
    return 0;
  }

  const last = table.length - 1;

  if (value >= table[last]) {
    return 1;
  }

  let lo = 0;
  let hi = last;

  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;

    if (table[mid] <= value) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const span = table[hi] - table[lo];
  const fraction = span > 0 ? (value - table[lo]) / span : 0;

  return (lo + fraction) / last;
}

function composite(features, weights, componentTables) {
  let total = 0;

  for (const [name, weight] of Object.entries(weights)) {
    total += weight * percentile(componentTables[name], features[name] || 0);
  }

  return total;
}

async function loadEra(era) {
  return cached(`era/${era.id}`, 60 * 60 * 24 * 30, async () => {
    const seasons = await Promise.all(era.sample.map(loadSeason));
    let pool = seasons.filter(Boolean).flat();

    if (!pool.length) {
      return null;
    }

    const qualified = pool.filter(row => row.g >= 20 && row.min >= 40);

    if (qualified.length >= 200) {
      pool = qualified;
    }

    const names = new Set();

    Object.values(ATTR_METRICS).concat(Object.values(TEND_METRICS)).forEach(weights => {
      Object.keys(weights).forEach(name => names.add(name));
    });

    const components = {};

    for (const name of names) {
      components[name] = quantiles(pool.map(row => row.f[name] || 0));
    }

    const composites = {};
    const all = { ...ATTR_METRICS, ...Object.fromEntries(Object.entries(TEND_METRICS).map(([k, v]) => [`t_${k}`, v])) };

    for (const [metric, weights] of Object.entries(all)) {
      composites[metric] = quantiles(pool.map(row => composite(row.f, weights, components)));
    }

    return { components, composites, size: pool.length, seasons: era.sample };
  });
}

function toAttribute(p) {
  return Math.round(p <= 0.5 ? 2 + 16 * p : 10 + 20 * (p - 0.5));
}

function toTendency(p) {
  return Math.round(-5 + 10 * p);
}

export async function bartProfiles(year, names) {
  const era = eraFor(year);

  if (!era) {
    return { ok: false, error: "Season outside Barttorvik coverage.", players: {} };
  }

  const [rows, eraTables] = await Promise.all([loadSeason(year), loadEra(era)]);

  if (!rows || !eraTables) {
    return { ok: false, error: "Barttorvik data unavailable.", players: {} };
  }

  const byName = new Map();

  for (const row of rows) {
    const key = normalizeName(row.name);
    const existing = byName.get(key);

    if (!existing || row.min > existing.min) {
      byName.set(key, row);
    }
  }

  const players = {};

  for (const name of names) {
    const row = byName.get(normalizeName(name));

    if (!row) {
      continue;
    }

    const attrs = {};
    const tend = {};

    for (const [code, weights] of Object.entries(ATTR_METRICS)) {
      const raw = composite(row.f, weights, eraTables.components);
      attrs[code] = toAttribute(percentile(eraTables.composites[code], raw));
    }

    for (const [key, weights] of Object.entries(TEND_METRICS)) {
      const raw = composite(row.f, weights, eraTables.components);
      tend[key] = toTendency(percentile(eraTables.composites[`t_${key}`], raw));
    }

    players[name] = {
      attrs,
      tend,
      g: row.g,
      yr: row.yr,
      ht: row.ht,
      role: row.role,
      team: row.team
    };
  }

  return {
    ok: true,
    era: era.id,
    poolSize: eraTables.size,
    poolSeasons: eraTables.seasons,
    players
  };
}

export async function handleBart(request) {
  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year"));
  const names = (url.searchParams.get("names") || "").split("|").filter(Boolean).slice(0, 200);

  if (!Number.isInteger(year) || year < FIRST_SEASON || year > 2100 || !names.length) {
    return Response.json({ ok: false, error: "Invalid request.", players: {} }, { status: 400 });
  }

  try {
    return Response.json(await bartProfiles(year, names));
  } catch (error) {
    return Response.json({ ok: false, error: String(error && error.message), players: {} });
  }
}

export { parseSeason };
