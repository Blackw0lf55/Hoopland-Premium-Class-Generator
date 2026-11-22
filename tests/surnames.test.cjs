const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const pools = html.slice(html.indexOf("const NAMES = {"), html.indexOf("const APPEARANCE_PALETTES"));
const chooser = html.slice(html.indexOf("function surnameKey("), html.indexOf("function makePlayer("));
const context = vm.createContext({});
const { names, key, choose } = vm.runInContext(
  `${pools}\nfunction pick(items) { return items[Math.floor(Math.random() * items.length)]; }\n${chooser}
   ({ names: NAMES, key: surnameKey, choose: chooseClassSurname })`,
  context
);

function draw(pool, counts) {
  const name = choose(pool, counts);
  const normalized = key(name);
  counts.set(normalized, (counts.get(normalized) || 0) + 1);
  return name;
}

test("each country can supply 70 distinct surnames", () => {
  for (const [country, pool] of Object.entries(names)) {
    const counts = new Map();
    const selected = Array.from({ length: 70 }, () => draw(pool.last, counts));
    assert.equal(new Set(selected.map(key)).size, 70, country);
    assert.ok(selected.every(name => pool.last.includes(name)), country);
  }
});

test("exhausted pools reuse least-used names, including previously used real surnames", () => {
  const counts = new Map([["smith", 2]]);
  const pool = ["Smith", "SMITH", "Jones", "Brown"];
  assert.notEqual(key(draw(pool, counts)), "smith");
  assert.notEqual(key(draw(pool, counts)), "smith");
  for (let i = 0; i < 50; i++) draw(pool, counts);
  assert.ok(Math.max(...counts.values()) - Math.min(...counts.values()) <= 1);
  assert.throws(() => choose([], counts), /Missing surnames/);
});

test("large US classes avoid repeats, including surnames already used by real players", () => {
  const counts = new Map([["smith", 1], ["jones", 1], ["williams", 1]]);
  const selected = Array.from({length: 250}, () => draw(names.US.last, counts));
  assert.equal(new Set(selected.map(key)).size, 250);
  assert.ok(selected.every(name => !["smith", "jones", "williams"].includes(key(name))));
});
