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
      fields.push(value);
      value = "";
    } else {
      value += character;
    }
  }

  fields.push(value);
  return fields;
}

function readValidLocations(csv) {
  return csv
    .split(/\r?\n/)
    .slice(1)
    .map(parseCsvRow)
    .filter(row => row.length >= 5)
    .map(row => ({ x: Number(row[3]), y: Number(row[4]) }))
    .filter(location => Number.isFinite(location.x) && Number.isFinite(location.y));
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

  const locationPattern = /loc:\s*\{\s*x:\s*0,\s*y:\s*0\s*\}/;
  const functionTail = html.slice(functionStart);
  if (!locationPattern.test(functionTail)) return pageResponse;

  html = html.slice(0, functionStart) + functionTail.replace(
    locationPattern,
    "loc: window.__HOOPLAND_LOCATIONS[randomInteger(0, window.__HOOPLAND_LOCATIONS.length - 1)]"
  );

  const locationDataScript =
    `<script>window.__HOOPLAND_LOCATIONS=${JSON.stringify(locations)};</script>`;
  const bodyClose = html.toLowerCase().lastIndexOf("</body>");
  html = bodyClose >= 0
    ? `${html.slice(0, bodyClose)}${locationDataScript}${html.slice(bodyClose)}`
    : `${html}${locationDataScript}`;

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
