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
    .filter(location => Number.isFinite(location.x) && Number.isFinite(location.y));
}

function setZeroPhysicalAttributes(html) {
  return html
    .replace(/(\bSTR\s*:\s*)\[\s*player\.physical\.STR\s*,\s*player\.physical\.STR\s*\]/, "$1[0, 0]")
    .replace(/(\bSPD\s*:\s*)\[\s*player\.physical\.SPD\s*,\s*player\.physical\.SPD\s*\]/, "$1[0, 0]")
    .replace(/(\bSTM\s*:\s*)\[\s*player\.physical\.STA\s*,\s*player\.physical\.STA\s*\]/, "$1[0, 0]");
}

function locationResolverScript(locations) {
  const data = JSON.stringify(locations);
  return `<script>
window.__HOOPLAND_LOCATION_RECORDS=${data};
window.__HOOPLAND_RESOLVE_LOCATION=function(player){
  const records=window.__HOOPLAND_LOCATION_RECORDS;
  const countryNames={US:"United States",CA:"Canada",AU:"Australia",FR:"France",UK:"United Kingdom",DE:"Germany",ES:"Spain",RS:"Serbia",BE:"Belgium"};
  const normalize=value=>String(value||"").normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
  const playerCountry=countryNames[String(player.ctry||"").toUpperCase()]||String(player.ctry||"");
  let countryRecords=records.filter(item=>normalize(item.country)===normalize(playerCountry));
  if(!countryRecords.length) countryRecords=records.filter(item=>normalize(item.country)==="unitedstates");
  const hometown=String(player.home||"");
  const hometownPart=hometown.split(",")[0].trim();
  const homeKey=normalize(hometownPart);
  const exact=countryRecords.filter(item=>homeKey&&(normalize(item.city)===homeKey||normalize(item.state)===homeKey));
  const named=countryRecords.filter(item=>item.city||item.state);
  const choices=exact.length?exact:(named.length?named:countryRecords);
  if(!choices.length) return {home:hometown,ctry:player.ctry,loc:{x:0,y:0}};
  const selected=choices[Math.floor(Math.random()*choices.length)];
  const home=exact.length?hometown:(selected.city&&selected.state?selected.city+", "+selected.state:selected.city?selected.city+", "+selected.country:selected.state?selected.state+", "+selected.country:selected.country);
  return {home,ctry:player.ctry,loc:{x:selected.x,y:selected.y}};
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

  let html = await pageResponse.text();
  const functionStart = html.indexOf("function makeHoopLandPlayer(");
  if (functionStart < 0) return pageResponse;

  let functionTail = html.slice(functionStart);
  const functionHeader = /(function makeHoopLandPlayer\(\s*player\s*,\s*index\s*\)\s*\{\s*)return\s*\{/;
  if (!functionHeader.test(functionTail)) return pageResponse;

  functionTail = functionTail.replace(
    functionHeader,
    "$1const assignedLocation = window.__HOOPLAND_RESOLVE_LOCATION(player);\n  return {"
  );
  functionTail = functionTail.replace(/home:\s*player\.home/, "home: assignedLocation.home");
  functionTail = functionTail.replace(/ctry:\s*player\.ctry/, "ctry: assignedLocation.ctry");
  functionTail = functionTail.replace(
    /loc:\s*\{\s*x:\s*0,\s*y:\s*0\s*\}/,
    "loc: assignedLocation.loc"
  );
  functionTail = setZeroPhysicalAttributes(functionTail);
  html = html.slice(0, functionStart) + functionTail;

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
