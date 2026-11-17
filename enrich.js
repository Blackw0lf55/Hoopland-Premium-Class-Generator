const API = "https://www.wikidata.org/w/api.php";

async function wd(params) {
  const query = new URLSearchParams({ format: "json", origin: "*", ...params });
  const response = await fetch(`${API}?${query}`, {
    headers: { "User-Agent": "Hoopland-Class-Generator/1.0" }
  });

  return response.ok ? response.json() : null;
}

const claimId = (entity, property) =>
  entity?.claims?.[property]?.[0]?.mainsnak?.datavalue?.value?.id;

export async function wikidataProfile(name) {
  const search = await wd({
    action: "wbsearchentities",
    search: name,
    language: "en",
    limit: "10"
  });

  const candidates = (search?.search || []).filter(item =>
    /basketball/i.test(item.description || "")
  );

  if (!candidates.length) {
    return null;
  }

  const found = await wd({
    action: "wbgetentities",
    ids: candidates.slice(0, 5).map(item => item.id).join("|"),
    props: "claims|labels"
  });

  const entities = candidates
    .map(item => found?.entities?.[item.id])
    .filter(entity => entity && claimId(entity, "P19"));

  const person = entities[0];

  if (!person) {
    return null;
  }

  const image = person.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  const birthDate = person.claims?.P569?.[0]?.mainsnak?.datavalue?.value?.time;
  const heightClaim = person.claims?.P2048?.[0]?.mainsnak?.datavalue?.value;

  const placeId = claimId(person, "P19");
  const placeData = await wd({
    action: "wbgetentities",
    ids: placeId,
    props: "claims|labels"
  });
  const place = placeData?.entities?.[placeId];

  if (!place) {
    return null;
  }

  const coords = place.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
  const regionId = claimId(place, "P131");
  const countryId = claimId(place, "P17");
  const labelIds = [regionId, countryId].filter(Boolean);

  let labels = {};

  if (labelIds.length) {
    const labelData = await wd({
      action: "wbgetentities",
      ids: labelIds.join("|"),
      props: "labels"
    });

    labels = labelData?.entities || {};
  }

  const labelOf = id => labels[id]?.labels?.en?.value || "";
  const city = place.labels?.en?.value || "";
  const country = labelOf(countryId);
  const region = labelOf(regionId);

  return {
    city,
    region,
    country,
    home: [city, country === "United States of America" ? region : country || region]
      .filter(Boolean)
      .join(", "),
    lat: coords?.latitude,
    lon: coords?.longitude,
    birthDate: birthDate ? birthDate.replace(/^\+/, "").slice(0, 10) : undefined,
    heightMeters: heightClaim?.amount && /Q11573/.test(heightClaim.unit || "")
      ? Number(heightClaim.amount)
      : undefined,
    headshot: image
      ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(image)}?width=400`
      : undefined
  };
}
