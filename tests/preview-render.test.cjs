const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const pixelRenderer = fs.readFileSync(path.join(__dirname, "..", "hair-preview.js"), "utf8");
const grids = require("../data/hairstyle-grids.json");
const catalog = html.slice(html.indexOf("const HAIR_CATALOG ="), html.indexOf("const MEN_FACIAL_HAIR="));
const renderer = html.slice(html.indexOf("  function hairParts(ref,color)"), html.indexOf("  const lumOf="));
const context = vm.createContext({grids});
const { hairParts, facialSvg, accessorySvg, renderArt, hair, validHairGrids } = vm.runInContext(`
  ${catalog}
  ${pixelRenderer}
  let hairstyleGrids=grids;
  const hex=c=>/^[0-9a-f]{6}$/i.test(String(c||""))?"#"+c:null;
  const rect=(x,y,w,h,fill,extra="")=>{let s="";for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++)s+=\`<rect x="\${px}" y="\${py}" width="1" height="1" fill="\${fill}" \${extra}/>\`;return s;};
  function shadeColor(hex,factor){
    return [0,2,4].map(i=>Math.min(255,Math.round(parseInt(hex.slice(i,i+2),16)*factor)).toString(16).padStart(2,"0")).join("");
  }
  ${renderer}
  ({ hairParts, facialSvg, accessorySvg, renderArt, hair:getHairReference, validHairGrids })
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
    const markup=parts.front+parts.back;
    assert.doesNotMatch(markup, /<(?:path|polygon|circle|ellipse|line)\b/);
    for (const [,width,height] of markup.matchAll(/width="(\d+)" height="(\d+)"/g))
      assert.equal(width,height,`non-square pixel in hairstyle ${id}`);
  }
  assert.notEqual(hairParts(hair(53),"#303030").front,hairParts(hair(5),"#303030").front);
});

test("facial hair mock-ups distinguish clean shaven, mustache and beard", () => {
  assert.equal(facialSvg(0, "#303030"), "");
  assert.notEqual(facialSvg(5, "#303030"), facialSvg(4, "#303030"));
  for (let id=1;id<=31;id++) assert.ok(facialSvg(id,"#303030"), `empty facial hair ${id}`);
  assert.notEqual(facialSvg(1,"#303030"),facialSvg(9,"#303030"));
  assert.notEqual(facialSvg(4,"#303030"),facialSvg(16,"#303030"));
});

test("head accessory mock-ups distinguish eyewear, face masks, bands and a single eye cover", () => {
  const draw=id=>accessorySvg(id,"FF00AA");
  assert.equal(draw(0),"");
  for (let id=1;id<=25;id++) assert.ok(draw(id), `empty accessory ${id}`);
  assert.notEqual(draw(7),draw(1));
  assert.notEqual(draw(8),draw(9));
  assert.notEqual(draw(10),draw(6));
  assert.match(draw(10),/x="34"/);
  assert.doesNotMatch(draw(16),/width="20" height="9"/);
  assert.match(draw(17),/#FF00AA/i);
  assert.notEqual(draw(24),draw(25));
  for (const id of [4,5,6,15,24,25]) assert.match(draw(id),/opacity="\.45"/,`transparent eyewear ${id}`);
});

test("swept, tied and textured hairstyles follow their catalog features", () => {
  const draw = id => hairParts(hair(id), "#101010");
  assert.notEqual(draw(5).front, draw(4).front, "swept cut differs from a crop");
  assert.match(draw(70).front, /#121212/, "braids have lighter detail");
  assert.match(draw(130).front, /#121212/, "coils have lighter detail");
  assert.notEqual(draw(125).back, draw(64).back, "high bun differs from loose long hair");
  assert.notEqual(draw(153).front, draw(73).front, "center-parted locs differ from hanging locs");
  assert.notEqual(draw(165).front, draw(164).front, "side-swept spikes have a different silhouette");
  assert.notEqual(draw(130).back, draw(112).back, "large afro differs from close coils");
  assert.notEqual(JSON.stringify(draw(24)), JSON.stringify(draw(71)), "side-swept braids differ from rounded braids");
});

test("the three grids are rendered with their colors and malformed grids are rejected", () => {
  assert.equal(validHairGrids(grids),true);
  assert.equal(validHairGrids({...grids,"high-top fade":[]}),false);
  for (const [id,name] of [[26,"dreadlocks shoulder length"],[50,"high-top fade"],[70,"cornrows with bun"]]) {
    const front=hairParts(hair(id),"#808080").front;
    for(let y=0;y<24;y++) for(let x=0;x<24;x++) {
      const value=grids[name][y][x];
      if(value) assert.ok(front.includes(`x="${8+x*2}" y="${6+y*2}" width="2" height="2" fill="${["","#808080","#6d6d6d","#939393"][value]}"`),`${name} ${x},${y}`);
    }
  }
});

test("entire portrait including hair, facial hair and accessories uses square pixels", () => {
  const appearance = {skinC:"BF8C6B",hairC:"202020",browC:"181818",eyeC:"131009",hair:"0050",fHair:"0004",accessories:[{headAcc:"0007",headAccC:"FF00AA"}]};
  const svg = renderArt({appearance});
  assert.match(svg, /fill="#17171d"/);
  assert.match(svg, /fill="#fff"/);
  assert.doesNotMatch(svg, /<(?:path|polygon|circle|ellipse|line)\b/);
  for(const [,width,height] of svg.matchAll(/width="(\d+)" height="(\d+)"/g))
    assert.equal(width,height);
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
