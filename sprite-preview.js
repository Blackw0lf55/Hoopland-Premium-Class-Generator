"use strict";

// Each cached result is an immutable composition. Callers copy it to a
// display canvas instead of moving a cached canvas between DOM nodes.
function createSpriteRenderer({manifest, loadImage, createCanvas, maxEntries = 256}) {
  if (!manifest || typeof manifest !== "object" || !Number.isInteger(maxEntries) || maxEntries < 1)
    throw new Error("Invalid sprite renderer configuration");
  const imageCache = new Map(), compositions = new Map();
  function image(path) {
    if (!imageCache.has(path)) {
      const promise = Promise.resolve().then(() => loadImage(path));
      imageCache.set(path, promise);
      promise.catch(() => imageCache.delete(path));
    }
    return imageCache.get(path);
  }
  function parseColor(color) {
    if (!/^#?[0-9a-f]{6}$/i.test(String(color))) throw new Error("Invalid sprite color");
    const hex = String(color).replace(/^#/, "");
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  }
  function tintPixels(ctx, width, height, color, skin) {
    const data = ctx.getImageData(0, 0, width, height);
    const pixels = data.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b, alpha] = pixels.subarray(i, i + 4);
      if (!alpha) continue;
      // Only warm, sufficiently bright pixels in the supplied base are skin;
      // dark outlines, white eyes, and the jersey remain untouched.
      if (skin && !(r > 110 && g > 65 && r - g > 8 && g - b > 5 && r - b > 24)) continue;
      if (skin) {
        // The base's unshaded skin is approximately #e7ae78. Channel ratios
        // retain its original highlights and shadows instead of flattening them.
        const reference = [231, 174, 120];
        for (let c = 0; c < 3; c++)
          pixels[i + c] = Math.min(255, Math.round(pixels[i + c] * color[c] / reference[c]));
      } else {
        const light = .2126 * r + .7152 * g + .0722 * b;
        const factor = light / 32;
        for (let c = 0; c < 3; c++) pixels[i + c] = Math.min(255, Math.round(color[c] * factor));
      }
    }
    ctx.putImageData(data, 0, 0);
  }
  function surface(width, height) {
    const canvas = createCanvas(width, height);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", {willReadFrequently: true});
    if (!ctx) throw new Error("Sprite preview requires a 2D canvas");
    ctx.imageSmoothingEnabled = false;
    return [canvas, ctx];
  }
  function supportsStyle(style) {
    return Number.isInteger(style) && Object.hasOwn(manifest, String(style));
  }
  async function renderPlayer({skinColor, hairStyle, hairColor, facialHair = null, accessories = []}) {
    if (!supportsStyle(hairStyle)) throw new Error(`No reviewed sprite for hairstyle ${hairStyle}`);
    const skin = parseColor(skinColor), hair = parseColor(hairColor);
    if (!Array.isArray(accessories) || accessories.some(p => typeof p !== "string") ||
        (facialHair !== null && typeof facialHair !== "string")) {
      throw new Error("Invalid sprite overlay paths");
    }
    const entry = manifest[String(hairStyle)];
    if (!entry || entry.file !== `hair_${String(hairStyle).padStart(3, "0")}.png`)
      throw new Error("Invalid hair manifest entry");
    const key = JSON.stringify([skin, hairStyle, hair, facialHair, accessories]);
    if (compositions.has(key)) {
      const existing = compositions.get(key);
      compositions.delete(key);
      compositions.set(key, existing);
      return existing;
    }
    const work = (async () => {
      const paths = ["assets/player_base.png", `assets/hair/${entry.file}`,
        ...(facialHair ? [facialHair] : []), ...accessories];
      const layers = await Promise.all(paths.map(image));
      const width = layers[0].naturalWidth || layers[0].width;
      const height = layers[0].naturalHeight || layers[0].height;
      if (!width || !height || layers.some(layer =>
        (layer.naturalWidth || layer.width) !== width || (layer.naturalHeight || layer.height) !== height)) {
        throw new Error("Sprite layers must share the base canvas dimensions");
      }
      const [result, ctx] = surface(width, height);
      ctx.drawImage(layers[0], 0, 0);
      tintPixels(ctx, width, height, skin, true);
      const [hairCanvas, hairCtx] = surface(width, height);
      hairCtx.drawImage(layers[1], 0, 0);
      tintPixels(hairCtx, width, height, hair, false);
      ctx.drawImage(hairCanvas, 0, 0);
      for (const layer of layers.slice(2)) ctx.drawImage(layer, 0, 0);
      return result;
    })();
    compositions.set(key, work);
    work.catch(() => { if (compositions.get(key) === work) compositions.delete(key); });
    while (compositions.size > maxEntries) compositions.delete(compositions.keys().next().value);
    return work;
  }
  return {supportsStyle, renderPlayer};
}

if (typeof module !== "undefined") module.exports = {createSpriteRenderer};
