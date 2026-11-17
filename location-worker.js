import existingWorker from "./worker.js";

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
    "const player = {\n    isReal: Boolean(sourcePlayer),"
  );
  if (!makePlayerCode) return null;

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

  return html.slice(0, makePlayerStart) + makePlayerCode + html.slice(generateClassStart, exportStart) + exportCode;
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
  const country=(known&&known.country)||countryNames[String(player.ctry||"").toUpperCase()]||String(player.ctry||"");
  let candidates=records.filter(record=>normalize(record.country)===normalize(country));
  if(!candidates.length)candidates=records;

  let target=known&&known.target?{x:Math.round(known.target.x),y:Math.round(known.target.y)}:null;
  if(!target&&Number.isFinite(Number(player.homeX))&&Number.isFinite(Number(player.homeY))){
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

  // Keep the true hometown; never substitute a random location for a real player.
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
    if (pathname === "/" || pathname === "/index.html") {
      return addLocationAssignment(request, env);
    }
    return existingWorker.fetch(request, env, context);
  }
};
