const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const catalog = html.slice(html.indexOf("const HAIR_CATALOG ="), html.indexOf("const MEN_FACIAL_HAIR="));
const renderer = html.slice(html.indexOf("  function hairParts(ref,color)"), html.indexOf("  function accessorySvg(id,color)"));
const context = vm.createContext({});
const { hairParts, facialSvg, hair } = vm.runInContext(`
  ${catalog}
  const hex=c=>/^[0-9a-f]{6}$/i.test(String(c||""))?"#"+c:null;
  const rect=(x,y,w,h,fill,extra="")=>\`<rect x="\${x}" y="\${y}" width="\${w}" height="\${h}" fill="\${fill}" \${extra}/>\`;
  function shadeColor(hex,factor){
    return [0,2,4].map(i=>Math.min(255,Math.round(parseInt(hex.slice(i,i+2),16)*factor)).toString(16).padStart(2,"0")).join("");
  }
  ${renderer}
  ({ hairParts, facialSvg, hair:getHairReference })
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
