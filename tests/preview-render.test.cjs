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

test("all documented styles 0 through 170 render and close cuts have pixel silhouettes", () => {
  for (let id=0;id<=170;id++) {
    assert.ok(hair(id), `missing hairstyle ${id}`);
    const parts=hairParts(hair(id),"#303030");
    if (id) assert.ok(parts.front || parts.back, `empty hairstyle ${id}`);
  }
  assert.notEqual(hairParts(hair(1),"#303030").front,hairParts(hair(4),"#303030").front);
  assert.notEqual(hairParts(hair(168),"#303030").front,hairParts(hair(67),"#303030").front);
  assert.notEqual(hairParts(hair(53),"#303030").front,hairParts(hair(5),"#303030").front);
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
  assert.notEqual(draw(165).front, draw(164).front, "side-swept spikes have a different silhouette");
  assert.notEqual(draw(130).back, draw(112).back, "large afro differs from close coils");
  assert.notEqual(draw(24).front, draw(71).front, "side-swept braids differ from rounded braids");
});

test("preview renders a black jersey with white trim", () => {
  const appearance = {skinC:"BF8C6B",hairC:"202020",browC:"181818",eyeC:"131009",hair:"0000",fHair:"0000",accessories:[]};
  const svg = renderArt({appearance});
  assert.match(svg, /fill="#17171d"/);
  assert.match(svg, /stroke="#fff" stroke-width="2"/);
  assert.match(svg, /stroke-linejoin="miter"/);
  assert.doesNotMatch(svg, /#d93a3a/);
});

test("editor displays color swatches and numeric style IDs without losing accessible labels", () => {
  const editor = html.slice(html.indexOf("  const lumOf="), html.indexOf("  function buildChoices("));
  const { setChoice, elements } = vm.runInNewContext(`
    const elements={};
    const $=id=>elements[id]||(elements[id]={style:{},setAttribute(name,value){this[name]=value;}});
    ${editor}
    ({setChoice,elements});
  `);
  setChoice("skin","skin",[["BF8C6B","Medium 1","BF8C6B"]],"BF8C6B");
  assert.equal(elements.skin.textContent,"");
  assert.equal(elements.skin.style.background,"#BF8C6B");
  assert.match(elements.skin["aria-label"],/Medium 1/);
  setChoice("hairColor","color",[["202020","Black 1","202020"]],"ABCDEF");
  assert.equal(elements.color.textContent,"");
  assert.equal(elements.color.style.background,"#ABCDEF");
  setChoice("hair","hair",[["0012","#12 Dense textured crop"]],"0012");
  assert.equal(elements.hair.textContent,"12");
  assert.match(elements.hair["aria-label"],/Dense textured crop/);
  setChoice("facial","facial",[["0004","#4 Beard"]],"0004");
  assert.equal(elements.facial.textContent,"4");
  setChoice("accessory","accessory",[["none","#0 No accessory"]],"none");
  assert.equal(elements.accessory.textContent,"0");
});
