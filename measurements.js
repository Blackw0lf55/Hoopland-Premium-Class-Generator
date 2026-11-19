export function athleteDimensions(athlete) {
  const displayHeight = String(athlete?.displayHeight || "").match(/^(\d)\s*['′-]\s*(\d{1,2})\s*(?:["″]|in)?$/i);
  const displayedInches = displayHeight && Number(displayHeight[2]) < 12
    ? Number(displayHeight[1]) * 12 + Number(displayHeight[2]) : null;
  const height = displayedInches ?? Number(athlete?.height);
  const displayWeight = String(athlete?.displayWeight || "").match(/^(\d{2,3}(?:\.\d+)?)\s*(?:lbs?\.?|pounds?)$/i);
  const weight = displayWeight ? Number(displayWeight[1]) : Number(athlete?.weight);
  return {
    ...(Number.isFinite(height) && height >= 48 && height <= 100 ? {height:Math.round(height)} : {}),
    ...(Number.isFinite(weight) && weight >= 70 && weight <= 500 ? {weight:Math.round(weight)} : {})
  };
}
