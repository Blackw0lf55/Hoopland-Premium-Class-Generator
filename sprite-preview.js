"use strict";

// Each cached result is an immutable composition. Callers copy it to a
// display canvas instead of moving a cached canvas between DOM nodes.
function createSpriteRenderer({manifest, facialManifest = {}, accessoryManifest = {}, atlas = null, loadImage, createCanvas, maxEntries = 256}) {
  if (!manifest || typeof manifest !== "object" || !Number.isInteger(maxEntries) || maxEntries < 1)
    throw new Error("Invalid sprite renderer configuration");
  const imageCache = new Map(), compositions = new Map(), tintedLayers = new Map();
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
  function tintPixels(ctx, width, height, color, skin, intensity = 32, referenceColor = null) {
    const data = ctx.getImageData(0, 0, width, height);
    const pixels = data.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b, alpha] = pixels.subarray(i, i + 4);
      if (!alpha) continue;
      // Only warm pixels in the supplied base are skin;
      // dark outlines, white eyes, and the jersey remain untouched.
      if (skin && !(r > 65 && g > 40 && r - g > 3 && g - b > 10 && r - b > 20)) continue;
      if (skin) {
        const light = .2126 * r + .7152 * g + .0722 * b;
        const reference = .2126 * 231 + .7152 * 174 + .0722 * 120;
        for (let c = 0; c < 3; c++) pixels[i + c] = Math.min(255, Math.round(color[c] * light / reference));
      } else if (referenceColor) {
        const light = .2126 * r + .7152 * g + .0722 * b;
        const reference = .2126 * referenceColor[0] + .7152 * referenceColor[1] + .0722 * referenceColor[2];
        for (let c = 0; c < 3; c++) pixels[i + c] = Math.min(255, Math.round(color[c] * light / reference));
      } else {
        const light = .2126 * r + .7152 * g + .0722 * b;
        const factor = light / intensity;
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
  function supportsFacialHair(style) {
    return Number.isInteger(style) && Object.hasOwn(facialManifest, String(style));
  }
  function supportsAccessory(style) {
    return Number.isInteger(style) && Object.hasOwn(accessoryManifest, String(style));
  }
  function overlayEntry(entries, style, prefix, directory) {
    const entry = entries[String(style)];
    if (!Number.isInteger(style) || style < 1 ||
        !entry || entry.file !== `${prefix}_${String(style).padStart(3, "0")}.png`)
      throw new Error(`No reviewed sprite for ${prefix} ${style}`);
    return {path: `assets/${directory}/${entry.file}`, entry};
  }
  async function layer(path) {
    if (!atlas) return {source: await image(path), rect: null};
    const rect = atlas[path];
    if (!Array.isArray(rect) || rect.length !== 6 || rect.some(value => !Number.isInteger(value) || value < 0))
      throw new Error(`Missing sprite atlas entry for ${path}`);
    return {source: await image("assets/sprite_atlas.png"), rect};
  }
  function drawLayer(ctx, item, x = 0, y = 0) {
    if (!item.rect) {
      ctx.drawImage(item.source, x, y);
    } else {
      const [sx, sy, width, height] = item.rect;
      if (width && height) ctx.drawImage(item.source, sx, sy, width, height, x, y, width, height);
    }
  }
  function tinted(key, width, height, paint, color, skin, intensity, referenceColor) {
    if (tintedLayers.has(key)) {
      const cached = tintedLayers.get(key);
      tintedLayers.delete(key);
      tintedLayers.set(key, cached);
      return cached;
    }
    const [canvas, ctx] = surface(width, height);
    paint(ctx);
    tintPixels(ctx, width, height, color, skin, intensity, referenceColor);
    tintedLayers.set(key, canvas);
    while (tintedLayers.size > maxEntries) tintedLayers.delete(tintedLayers.keys().next().value);
    return canvas;
  }
  async function renderPlayer({skinColor, hairStyle, hairColor, facialHair = null, facialHairColor = null, accessories = []}) {
    if (!supportsStyle(hairStyle)) throw new Error(`No reviewed sprite for hairstyle ${hairStyle}`);
    const skin = parseColor(skinColor), hair = parseColor(hairColor);
    if (!Array.isArray(accessories)) {
      throw new Error("Invalid sprite overlay paths");
    }
    let facial = null;
    if (typeof facialHair === "string") {
      facial = {path: facialHair, color: facialHairColor === null ? null : parseColor(facialHairColor)};
    } else if (facialHair !== null && facialHair !== 0) {
      const {path} = overlayEntry(facialManifest, facialHair, "facial", "facial_hair");
      facial = {path, color: parseColor(facialHairColor === null ? hairColor : facialHairColor)};
    }
    const accessoryLayers = accessories.map(accessory => {
      if (typeof accessory === "string") return {path: accessory, color: null};
      if (!accessory || typeof accessory !== "object") throw new Error("Invalid sprite accessory");
      const {path, entry} = overlayEntry(accessoryManifest, accessory.style, "accessory", "accessories");
      const referenceColor = parseColor(entry.referenceColor);
      if (referenceColor.some(channel => channel === 0)) throw new Error("Invalid accessory reference color");
      return {path, color: parseColor(accessory.color), referenceColor};
    });
    const entry = manifest[String(hairStyle)];
    if (!entry || entry.file !== `hair_${String(hairStyle).padStart(3, "0")}.png`)
      throw new Error("Invalid hair manifest entry");
    const key = JSON.stringify([skin, hairStyle, hair, facial, accessoryLayers]);
    if (compositions.has(key)) {
      const existing = compositions.get(key);
      compositions.delete(key);
      compositions.set(key, existing);
      return existing;
    }
    const work = (async () => {
      const overlays = [...(facial ? [facial] : []), ...accessoryLayers];
      const paths = ["assets/player_base.png", `assets/hair/${entry.file}`, ...overlays.map(layer => layer.path)];
      const [base, ...layers] = await Promise.all([image(paths[0]), ...paths.slice(1).map(layer)]);
      const width = base.naturalWidth || base.width;
      const height = base.naturalHeight || base.height;
      if (!width || !height || layers.some(({source, rect}) => rect
        ? rect[0] + rect[2] > (source.naturalWidth || source.width) ||
          rect[1] + rect[3] > (source.naturalHeight || source.height) ||
          rect[4] + rect[2] > width || rect[5] + rect[3] > height
        : (source.naturalWidth || source.width) !== width || (source.naturalHeight || source.height) !== height)) {
        throw new Error("Sprite layers must share the base canvas dimensions");
      }
      const [result, ctx] = surface(width, height);
      const skinCanvas = tinted(JSON.stringify([paths[0], skin]), width, height,
        layerCtx => layerCtx.drawImage(base, 0, 0), skin, true);
      ctx.drawImage(skinCanvas, 0, 0);
      [{color: hair, intensity: 32}, ...overlays.map(overlay => ({...overlay, intensity: 128}))]
        .forEach((overlay, index) => {
          const item = layers[index];
          const [,, layerWidth, layerHeight, x, y] = item.rect || [0, 0, width, height, 0, 0];
          if (!layerWidth || !layerHeight) return;
          if (!overlay.color) {
            drawLayer(ctx, item, x, y);
            return;
          }
          const canvas = tinted(JSON.stringify([paths[index + 1], overlay.color, overlay.intensity, overlay.referenceColor]),
            layerWidth, layerHeight, layerCtx => drawLayer(layerCtx, item),
            overlay.color, false, overlay.intensity, overlay.referenceColor);
          ctx.drawImage(canvas, x, y);
        });
      return result;
    })();
    compositions.set(key, work);
    work.catch(() => { if (compositions.get(key) === work) compositions.delete(key); });
    while (compositions.size > maxEntries) compositions.delete(compositions.keys().next().value);
    return work;
  }
  return {supportsStyle, supportsFacialHair, supportsAccessory, renderPlayer};
}

if (typeof module !== "undefined") module.exports = {createSpriteRenderer};
