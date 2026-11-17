const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const catalog = html.slice(html.indexOf("const HAIR_CATALOG ="), html.indexOf("const MEN_FACIAL_HAIR="));
const renderer = html.slice(html.indexOf("  function hairParts(ref,color)"), html.indexOf("  const lumOf="));
const context = vm.createContext({});
const { hairParts, facialSvg, renderArt, hair } = vm.runInContext(`
  ${catalog}
  const hex=c=>/^[0-9a-f]{6}$/i.test(String(c||""))?"#"+c:null;
  const rect=(x,y,w,h,fill,extra="")=>\`<rect x="\${x}" y="\${y}" width="\${w}" height="\${h}" fill="\${fill}" \${extra}/>\`;
  function shadeColor(hex,factor){
    return [0,2,4].map(i=>Math.min(255,Math.round(parseInt(hex.slice(i,i+2),16)*factor)).toString(16).padStart(2,"0")).join("");
  }
  ${renderer}
  ({ hairParts, facialSvg, renderArt, hair:getHairReference })
`, context);

test("bald is empty and distinct hairstyles have distinct mock-ups", () => {
  const render = id => JSON.stringify(hairParts(hair(id), "#303030"));
  const bald = hairParts(hair(0), "#303030");
  assert.equal(bald.front, "");
  assert.equal(bald.back, "");
  assert.notEqual(render(1), render(2));
  assert.notEqual(render(70), render(1));
  assert.notEqual(render(125), render(1));
  assert.notEqual(render(167), render(1));
});

test("facial hair mock-ups distinguish clean shaven, mustache and beard", () => {
  assert.equal(facialSvg(0, "#303030"), "");
  assert.notEqual(facialSvg(5, "#303030"), facialSvg(4, "#303030"));
});

test("swept, tied and textured hairstyles follow their catalog features", () => {
  const draw = id => hairParts(hair(id), "#101010");
  assert.notEqual(draw(5).front, draw(4).front, "swept cut differs from a crop");
  assert.match(draw(70).front, /stroke-opacity/, "locs have visible strand detail");
  assert.match(draw(130).back, /opacity/, "coils have texture even with black hair");
  assert.notEqual(draw(125).back, draw(64).back, "high bun differs from loose long hair");
  assert.notEqual(draw(153).front, draw(73).front, "center-parted locs differ from hanging locs");
});

test("preview renders a black jersey with white trim", () => {
  const appearance = {skinC:"BF8C6B",hairC:"202020",browC:"181818",eyeC:"131009",hair:"0000",fHair:"0000",accessories:[]};
  const svg = renderArt({appearance});
  assert.match(svg, /fill="#17171d"/);
  assert.match(svg, /stroke="#fff" stroke-width="2"/);
  assert.doesNotMatch(svg, /#d93a3a/);
});
