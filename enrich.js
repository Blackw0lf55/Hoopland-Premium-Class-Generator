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

function personNameKey(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function wikidataProfile(name) {
  const search = await wd({
    action: "wbsearchentities",
    search: name,
    language: "en",
    limit: "10"
  });

  const wanted = personNameKey(name);
  const candidates = (search?.search || []).filter(item =>
    /basketball/i.test(item.description || "") &&
    [item.label, item.match?.text, ...(item.aliases || [])].some(value => personNameKey(value) === wanted)
  );

  if (!wanted || candidates.length !== 1) {
    return null;
  }

  const found = await wd({
    action: "wbgetentities",
    ids: candidates[0].id,
    props: "claims|labels"
  });

  const person = found?.entities?.[candidates[0].id];

  if (!person || !claimId(person, "P19")) {
    return null;
  }

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
      : undefined
  };
}
