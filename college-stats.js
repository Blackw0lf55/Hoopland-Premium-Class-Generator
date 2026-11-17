const FIRST_SEASON = 2008;

const ERAS = [
  { id: 4, from: 2008, to: 2015 },
  { id: 5, from: 2016, to: 2021 },
  { id: 6, from: 2022, to: 2100 }
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
  STL: { stl: 1 },
  BLK: { blk: 1 }
};

const TEND_METRICS = {
  dunk: { dunkShare: 0.6, dunkA: 0.4 },
  floater: { c2Share: 0.5, c2A: 0.3, ftr: 0.2 },
  hook: { c2Share: 0.5, or: 0.5 },
  post: { c2Share: 0.5, ftr: 0.5 },
  twoPoint: { f2Share: 0.5, f2A: 0.5 },
  threePoint: { tpr: 0.5, tpA: 0.5 },
  pumpFake: { ftr: 0.5, f2Share: 0.25, tpr: 0.25 },
  fades: { f2Share: 0.6, f2A: 0.4 },
  pass: { ast: 0.6, astG: 0.4 },
  lob: { ast: 0.6, dunkM: 0.4 },
  cross: { usg: 0.5, ast: 0.3, a2o: 0.2 },
  spin: { usg: 0.5, c2A: 0.3, ftr: 0.2 },
  step: { tpr: 0.4, usg: 0.3, f2Share: 0.3 },
  offReb: { or: 1 },
  runPlay: { ast: 0.5, a2o: 0.5 },
  defReb: { dr: 1 },
  takeCharge: { dr: 0.5, stl: 0.5 },
  stealOnBall: { stl: 1 },
  stealOffBall: { stl: 1 },
  block: { blk: 1 }
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

function adjusted(made, attempts, [league, strength]) {
  if (!attempts) {
    return -1;
  }

  return (made + league * strength) / (attempts + strength);
}

function featuresFor(row) {
  const [dM, dA, cM, cA, fM, fA, ftM, ftA, tpM, tpA, orb, drb, ast, blk, stl, to, fga] = row.s;
  const g = row.g || 1;
  const minutes = Math.max(row.g * row.m, 1);
  const per40 = value => (value / minutes) * 40;
  const shots = Math.max(fga, 1);

  return {
    dunkM: dM / g,
    dunkA: dA / g,
    dunkP: adjusted(dM, dA, LEAGUE.dunk),
    dunkShare: dA / shots,
    c2M: cM / g,
    c2A: cA / g,
    c2P: adjusted(cM, cA, LEAGUE.c2),
    c2Share: cA / shots,
    f2M: fM / g,
    f2A: fA / g,
    f2P: adjusted(fM, fA, LEAGUE.f2),
    f2Share: fA / shots,
    ftM: ftM / g,
    ftA: ftA / g,
    ftP: adjusted(ftM, ftA, LEAGUE.ft),
    tpM: tpM / g,
    tpA: tpA / g,
    tpP: adjusted(tpM, tpA, LEAGUE.tp),
    tpr: tpA / shots,
    usg: per40(fga + 0.44 * ftA + to),
    ast: per40(ast),
    astG: ast / g,
    toInv: -per40(to),
    a2o: Math.min(ast / Math.max(to, 1), 6),
    blk: per40(blk),
    stl: per40(stl),
    ftr: ftA / shots,
    or: per40(orb),
    dr: per40(drb),
    reb: (orb + drb) / g
  };
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

const datasets = {};

async function loadDataset(gender, env) {
  if (datasets[gender]) {
    return datasets[gender];
  }

  const response = await env.ASSETS.fetch(new Request(`https://assets.local/data/college-${gender}.json`));

  if (!response.ok) {
    return null;
  }

  const raw = await response.json();
  const data = {};

  for (const [year, rows] of Object.entries(raw)) {
    data[year] = rows.map(row => ({ ...row, f: featuresFor(row) }));
  }

  datasets[gender] = data;

  return data;
}

async function loadSeason(year, env, gender) {
  const data = await loadDataset(gender, env);

  return data && data[year] && data[year].length ? data[year] : null;
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

function currentSeason() {
  const now = new Date();

  return now.getFullYear() + (now.getMonth() >= 10 ? 1 : 0);
}

async function loadEra(era, env, gender) {
  return cached(`era/${gender}/${era.id}`, 60 * 60 * 24 * 30, async () => {
    const data = await loadDataset(gender, env);

    if (!data) {
      return null;
    }

    const years = Object.keys(data)
      .map(Number)
      .filter(year => year >= era.from && year <= era.to && year < currentSeason());

    let pool = years.flatMap(year => data[year]);

    if (!pool.length) {
      return null;
    }

    const qualified = pool.filter(row => row.g >= 20 && row.g * row.m >= 500);

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

    return { components, composites, size: pool.length, seasons: years };
  });
}

function toAttribute(p) {
  return Math.round(p <= 0.5 ? 2 + 16 * p : 10 + 20 * (p - 0.5));
}

function toTendency(p) {
  return Math.round(-5 + 10 * p);
}

export async function statProfiles(year, names, env, gender = "men") {
  const era = eraFor(year);

  if (!era) {
    return { ok: false, error: "Season outside stats coverage.", players: {} };
  }

  const [rows, eraTables] = await Promise.all([loadSeason(year, env, gender), loadEra(era, env, gender)]);

  if (!rows || !eraTables) {
    return { ok: false, error: "College stats unavailable.", players: {} };
  }

  const byName = new Map();

  for (const row of rows) {
    const key = normalizeName(row.n);
    const existing = byName.get(key);

    if (!existing || row.g * row.m > existing.g * existing.m) {
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
      yr: "",
      mpg: row.m,
      pos: row.p,
      team: row.t,
      shotZones: Boolean(row.z)
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

export async function handleStats(request, env) {
  const gender = new URL(request.url).searchParams.get("gender") === "women" ? "women" : "men";
  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year"));
  const names = (url.searchParams.get("names") || "").split("|").filter(Boolean).slice(0, 200);

  if (!Number.isInteger(year) || year < FIRST_SEASON || year > 2100 || !names.length) {
    return Response.json({ ok: false, error: "Invalid request.", players: {} }, { status: 400 });
  }

  try {
    if (url.searchParams.get("debug")) {
      const data = await loadDataset(gender, env);
      const rows = data && data[year] ? data[year] : [];

      return Response.json({
        seasons: data ? Object.fromEntries(Object.entries(data).map(([y, r]) => [y, r.length])) : null,
        sampleRow: rows[0] || null,
        match: rows.find(row => names.some(name => normalizeName(name) === normalizeName(row.n))) || null,
        profiles: await statProfiles(year, names, env, gender)
      });
    }

    return Response.json(await statProfiles(year, names, env, gender));
  } catch (error) {
    return Response.json({ ok: false, error: String(error && error.message), players: {} });
  }
}

