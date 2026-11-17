import existingWorker from "./worker.js";

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

function transformGenerator(html, locations) {
  const makePlayerStart = html.indexOf("function makePlayer(");
  const exportStart = html.indexOf("function makeHoopLandPlayer(");
  if (makePlayerStart < 0 || exportStart < 0) return null;

  const beforeMakePlayer = html.slice(0, makePlayerStart);
  let makePlayerAndRest = html.slice(makePlayerStart);
  const makePlayerEnd = makePlayerAndRest.indexOf("async function generateClass(");
  if (makePlayerEnd < 0) return null;

  let makePlayerCode = makePlayerAndRest.slice(0, makePlayerEnd);
  const hometownPattern = /const hometown\s*=\s*pick\(namePool\.hometowns\);/;
  if (!hometownPattern.test(makePlayerCode)) return null;
  makePlayerCode = makePlayerCode.replace(
    hometownPattern,
    'const hometown = sourcePlayer ? window.__HOOPLAND_REAL_HOMETOWN(sourcePlayer) : "";'
  );
  makePlayerCode = makePlayerCode.replace(
    /const player\s*=\s*\{\s*/,
    'const player = {\n    isReal: Boolean(sourcePlayer),\n'
  );
  makePlayerAndRest = makePlayerCode + makePlayerAndRest.slice(makePlayerEnd);
  html = beforeMakePlayer + makePlayerAndRest;

  const newExportStart = html.indexOf("function makeHoopLandPlayer(");
  let exportTail = html.slice(newExportStart);
  const exportHeader = /(function makeHoopLandPlayer\(\s*player\s*,\s*index\s*\)\s*\{\s*)return\s*\{/;
  if (!exportHeader.test(exportTail)) return null;
  exportTail = exportTail.replace(
    exportHeader,
    "$1const assignedLocation = window.__HOOPLAND_RESOLVE_LOCATION(player);\n  return {"
  );
  exportTail = exportTail.replace(/home:\s*player\.home/, "home: assignedLocation.home");
  exportTail = exportTail.replace(/ctry:\s*player\.ctry/, "ctry: assignedLocation.ctry");
  exportTail = exportTail.replace(
    /loc:\s*\{\s*x:\s*0,\s*y:\s*0\s*\}/,
    "loc: assignedLocation.loc"
  );
  exportTail = exportTail
    .replace(/(\bSTR\s*:\s*)\[\s*player\.physical\.STR\s*,\s*player\.physical\.STR\s*\]/, "$1[0, 0]")
    .replace(/(\bSPD\s*:\s*)\[\s*player\.physical\.SPD\s*,\s*player\.physical\.SPD\s*\]/, "$1[0, 0]")
    .replace(/(\bSTM\s*:\s*)\[\s*player\.physical\.STA\s*,\s*player\.physical\.STA\s*\]/, "$1[0, 0]");
  return html.slice(0, newExportStart) + exportTail;
}

function locationResolverScript(locations) {
  const locationData = JSON.stringify(locations);
  // These hometown coordinates are rounded to the generator's integer scale (latitude/longitude × 100).
  const knownPlayers = JSON.stringify({
    azzifudd: { home: "Arlington, Virginia", country: "United States", x: 3888, y: -7711 },
    oliviamiles: { home: "Phillipsburg, New Jersey", country: "United States", x: 4069, y: -7519 }
  });

  return `<script>
window.__HOOPLAND_LOCATION_RECORDS=${locationData};
window.__HOOPLAND_REAL_PLAYER_HOMETOWNS=${knownPlayers};
window.__HOOPLAND_NORMALIZE_LOCATION_NAME=function(value){
  return String(value||"").normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
};
window.__HOOPLAND_REAL_HOMETOWN=function(sourcePlayer){
  const key=window.__HOOPLAND_NORMALIZE_LOCATION_NAME([sourcePlayer.fn,sourcePlayer.ln].filter(Boolean).join(" "));
  const known=window.__HOOPLAND_REAL_PLAYER_HOMETOWNS[key];
  return known?known.home:String(sourcePlayer.hometown||sourcePlayer.home||"").trim();
};
window.__HOOPLAND_RESOLVE_LOCATION=function(player){
  const records=window.__HOOPLAND_LOCATION_RECORDS;
  if(!player.isReal){
    if(!records.length) return {home:"",ctry:player.ctry,loc:{x:0,y:0}};
    const selected=records[Math.floor(Math.random()*records.length)];
    return {home:"",ctry:player.ctry,loc:{x:selected.x,y:selected.y}};
  }

  const nameKey=window.__HOOPLAND_NORMALIZE_LOCATION_NAME([player.fn,player.ln].filter(Boolean).join(" "));
  const known=window.__HOOPLAND_REAL_PLAYER_HOMETOWNS[nameKey];
  const home=known?known.home:String(player.home||"").trim();
  const countryNames={US:"United States",CA:"Canada",AU:"Australia",FR:"France",UK:"United Kingdom",GB:"United Kingdom",DE:"Germany",ES:"Spain",RS:"Serbia",BE:"Belgium"};
  const country=(known&&known.country)||countryNames[String(player.ctry||"").toUpperCase()]||String(player.ctry||"");
  let candidates=records.filter(item=>window.__HOOPLAND_NORMALIZE_LOCATION_NAME(item.country)===window.__HOOPLAND_NORMALIZE_LOCATION_NAME(country));
  if(!candidates.length) candidates=records;

  let target=known?{x:Math.round(known.x),y:Math.round(known.y)}:null;
  if(!target&&Number.isFinite(Number(player.homeX))&&Number.isFinite(Number(player.homeY))) target={x:Math.round(Number(player.homeX)),y:Math.round(Number(player.homeY))};
  if(target&&candidates.length){
    let nearest=candidates[0];
    let bestDistance=Infinity;
    for(const item of candidates){
      const distance=(item.x-target.x)**2+(item.y-target.y)**2;
      if(distance<bestDistance){nearest=item;bestDistance=distance;}
    }
    return {home,ctry:player.ctry,loc:{x:nearest.x,y:nearest.y}};
  }

  const homeTokens=home.split(",").map(value=>window.__HOOPLAND_NORMALIZE_LOCATION_NAME(value)).filter(Boolean);
  const exact=candidates.filter(item=>homeTokens.some(token=>token===window.__HOOPLAND_NORMALIZE_LOCATION_NAME(item.city)||token===window.__HOOPLAND_NORMALIZE_LOCATION_NAME(item.state)));
  if(exact.length){
    const selected=exact[0];
    return {home,ctry:player.ctry,loc:{x:selected.x,y:selected.y}};
  }

  // Do not invent a hometown or pretend a random coordinate is a real player's location.
  return {home,ctry:player.ctry,loc:{x:0,y:0}};
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
  if (locations.length === 0) return pageResponse;

  const originalHtml = await pageResponse.text();
  let html = transformGenerator(originalHtml, locations);
  if (!html) return pageResponse;

  const script = locationResolverScript(locations);
  const bodyClose = html.toLowerCase().lastIndexOf("</body>");
  html = bodyClose >= 0
    ? `${html.slice(0, bodyClose)}${script}${html.slice(bodyClose)}`
    : `${html}${script}`;

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
