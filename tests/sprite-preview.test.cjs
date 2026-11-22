const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {createSpriteRenderer} = require("../sprite-preview.js");

function harness() {
  const draws = [], loads = [];
  function createCanvas() {
    const canvas = {width: 0, height: 0, pixel: [0, 0, 0, 0]};
    const context = {
      drawImage(source, x, y) {
        draws.push([source.label || "canvas", x, y]);
        if (source.pixel?.[3]) canvas.pixel = [...source.pixel];
      },
      getImageData() { return {data: new Uint8ClampedArray(canvas.pixel)}; },
      putImageData(data) { canvas.pixel = [...data.data]; }
    };
    canvas.getContext = () => context;
    return canvas;
  }
  const assets = {
    "assets/player_base.png": {width: 1, height: 1, pixel: [210, 160, 120, 255]},
    "assets/hair/hair_001.png": {width: 1, height: 1, pixel: [32, 32, 32, 128]},
    "beard.png": {width: 1, height: 1, pixel: [90, 60, 30, 255]},
    "glasses.png": {width: 1, height: 1, pixel: [10, 10, 10, 255]},
    "assets/facial_hair/facial_001.png": {width: 1, height: 1, pixel: [128, 128, 128, 140]},
    "assets/accessories/accessory_001.png": {width: 1, height: 1, pixel: [107, 115, 128, 90]}
  };
  const manifest = {"1": {file: "hair_001.png", name: "Style 1"}};
  const renderer = createSpriteRenderer({
    manifest, createCanvas,
    facialManifest: {"1": {file: "facial_001.png"}},
    accessoryManifest: {"1": {file: "accessory_001.png", referenceColor: "6b7380"}},
    loadImage: async path => {
      loads.push(path);
      if (!assets[path]) throw new Error(`Missing ${path}`);
      return {...assets[path], label: path};
    }
  });
  return {renderer, assets, loads, draws};
}

test("numbered facial hair and accessories are tinted, retain alpha, and affect the cache key", async () => {
  const {renderer, draws, loads} = harness();
  const appearance = {skinColor: "bf8c6b", hairStyle: 1, hairColor: "804020",
    facialHair: 1, facialHairColor: "204060"};
  const beard = await renderer.renderPlayer(appearance);
  assert.deepEqual(beard.pixel, [32, 64, 96, 140]);
  const accessory = {...appearance, accessories: [{style: 1, color: "ff8040"}]};
  const result = await renderer.renderPlayer(accessory);
  assert.deepEqual(result.pixel, [255, 128, 64, 90]);
  assert.equal(await renderer.renderPlayer(accessory), result);
  assert.notEqual(await renderer.renderPlayer({...accessory, accessories: [{style: 1, color: "008040"}]}), result);
  assert.equal(loads.filter(p => p === "assets/accessories/accessory_001.png").length, 1);
  assert.ok(draws.every(([, x, y]) => x === 0 && y === 0));
  assert.equal(renderer.supportsFacialHair(1), true);
  assert.equal(renderer.supportsAccessory(1), true);
  assert.equal(renderer.supportsFacialHair(2), false);
  assert.equal(renderer.supportsAccessory(2), false);
  await assert.rejects(renderer.renderPlayer({...appearance, facialHair: 2}), /No reviewed sprite for facial/);
  await assert.rejects(renderer.renderPlayer({...appearance, accessories: [{style: 2, color: "ffffff"}]}), /No reviewed sprite for accessory/);
  await assert.rejects(renderer.renderPlayer({...appearance, facialHairColor: "bad"}), /Invalid sprite color/);
});

test("layers share an origin, compose in order, and cache identical appearances", async () => {
  const {renderer, draws, loads} = harness();
  const appearance = {skinColor: "#bf8c6b", hairStyle: 1, hairColor: "#3b2415",
    facialHair: "beard.png", accessories: ["glasses.png"]};
  const [first, second] = await Promise.all([renderer.renderPlayer(appearance), renderer.renderPlayer(appearance)]);
  assert.equal(first, second);
  assert.deepEqual(draws.map(item => item[0]),
    ["assets/player_base.png", "canvas", "assets/hair/hair_001.png", "canvas", "beard.png", "glasses.png"]);
  assert.ok(draws.every(([, x, y]) => x === 0 && y === 0));
  assert.equal(loads.length, 4);
  await renderer.renderPlayer({...appearance, hairColor: "#ffffff"});
  assert.equal(loads.length, 4, "decoded source images are reused");
  assert.equal(draws.length, 11, "a different appearance reuses the tinted base");
});

test("tinting preserves hair alpha and rejects invalid colors and mismatched canvases", async () => {
  const {renderer, assets} = harness();
  const appearance = {skinColor: "#bf8c6b", hairStyle: 1, hairColor: "#804020"};
  const canvas = await renderer.renderPlayer(appearance);
  assert.deepEqual(canvas.pixel, [128, 64, 32, 128]);
  await assert.rejects(renderer.renderPlayer({...appearance, hairColor: "nope"}), /Invalid sprite color/);
  await assert.rejects(renderer.renderPlayer({...appearance, hairStyle: 2}), /No reviewed sprite/);
  const other = harness();
  other.assets["assets/hair/hair_001.png"].width = 2;
  await assert.rejects(other.renderer.renderPlayer(appearance), /share the base canvas dimensions/);
  assert.equal(renderer.supportsStyle(1), true);
  assert.equal(renderer.supportsStyle(2), false);
});

test("skin shadows and highlights retain the selected hue; neutral accessory pixels do not turn green", async () => {
  const {renderer, assets} = harness();
  assets["assets/hair/hair_001.png"].pixel = [0, 0, 0, 0];
  const appearance = {skinColor: "604020", hairStyle: 1, hairColor: "000000"};
  for (const [source, skinColor] of [
    [[98, 87, 55, 255], "604020"],
    [[253, 245, 210, 255], "604020"],
    [[230, 175, 121, 128], "604020"]
  ]) {
    const h = harness();
    h.assets["assets/hair/hair_001.png"].pixel = [0, 0, 0, 0];
    h.assets["assets/player_base.png"].pixel = source;
    const pixel = (await h.renderer.renderPlayer({...appearance, skinColor})).pixel;
    assert.ok(Math.abs(pixel[0] - 3 * pixel[2]) <= 2);
    assert.ok(Math.abs(pixel[1] - 2 * pixel[2]) <= 2);
    assert.equal(pixel[3], source[3]);
  }
  assets["assets/accessories/accessory_001.png"].pixel = [22, 24, 21, 255];
  const pixel = (await renderer.renderPlayer({...appearance, accessories: [{style: 1, color: "ffffff"}]})).pixel;
  assert.equal(pixel[0], pixel[1]);
  assert.equal(pixel[1], pixel[2]);
});

test("atlas-based style changes load no individual sprite images", async () => {
  const loads = [];
  const renderer = createSpriteRenderer({
    manifest: {"1": {file: "hair_001.png"}, "2": {file: "hair_002.png"}},
    atlas: {"assets/hair/hair_001.png": [0, 0, 1, 1, 0, 0],
      "assets/hair/hair_002.png": [1, 0, 1, 1, 0, 0]},
    loadImage: async path => {
      loads.push(path);
      return {width: path.endsWith("atlas.png") ? 2 : 1, height: 1};
    },
    createCanvas: () => ({getContext: () => ({
      drawImage() {}, getImageData: () => ({data: new Uint8ClampedArray(4)}), putImageData() {}
    })})
  });
  const appearance = {skinColor: "604020", hairStyle: 1, hairColor: "000000"};
  await renderer.renderPlayer(appearance);
  await renderer.renderPlayer({...appearance, hairStyle: 2});
  assert.deepEqual(loads, ["assets/player_base.png", "assets/sprite_atlas.png"]);
});

test("appearance edits retain the preview until the latest render completes", async () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const code = html.slice(html.indexOf("  function showArt(player,clear=false)"), html.indexOf("  const lumOf="));
  const pending = [];
  const renderer = {
    renderPlayer: () => new Promise((resolve, reject) => pending.push({resolve, reject}))
  };
  const old = {};
  const art = {
    children: [old],
    replaceChildren(...children) { this.children = children; },
    hasChildNodes() { return this.children.length > 0; }
  };
  const error = {hidden: true, textContent: ""};
  const choice = {options: [["0"], ["1"], ["2"]], current: "1"};
  const context = vm.createContext({
    artVersion: 0, spriteRenderer: Promise.resolve(renderer),
    choices: {hair: choice, facial: choice, accessory: choice},
    $: id => id === "hlPvArt" ? art : error,
    document: {createElement: () => ({
      setAttribute() {}, getContext: () => ({drawImage() {}})
    })},
    console
  });
  vm.runInContext(code, context);
  const player = {appearance: {skinC: "604020", hair: "1", hairC: "000000"}};
  context.showArt(player);
  context.showArt(player);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(art.children[0], old);
  pending[0].resolve({width: 1, height: 1});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(art.children[0], old, "an older render must not replace the current preview");
  pending[1].resolve({width: 1, height: 1});
  await new Promise(resolve => setImmediate(resolve));
  assert.notEqual(art.children[0], old);
  context.showArt(player, true);
  assert.equal(art.children.length, 0, "changing players clears the previous player");
  assert.equal(error.hidden, false);
  await new Promise(resolve => setImmediate(resolve));
  pending[2].resolve({width: 1, height: 1});
  await new Promise(resolve => setImmediate(resolve));
});
