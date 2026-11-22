const {test} = require("node:test");
const assert = require("node:assert/strict");
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
    ["assets/player_base.png", "assets/hair/hair_001.png", "canvas", "beard.png", "glasses.png"]);
  assert.ok(draws.every(([, x, y]) => x === 0 && y === 0));
  assert.equal(loads.length, 4);
  await renderer.renderPlayer({...appearance, hairColor: "#ffffff"});
  assert.equal(loads.length, 4, "decoded source images are reused");
  assert.equal(draws.length, 10, "a different appearance is recomposed");
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
