const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const hairCode = fs.readFileSync(path.join(root, "hair-preview.js"), "utf8");
const portraitCode = fs.readFileSync(path.join(root, "portrait-preview.js"), "utf8");
const grids = require("../data/hairstyle-grids.json");
const catalog = html.slice(html.indexOf("const HAIR_CATALOG ="), html.indexOf("const MEN_FACIAL_HAIR="));
const document = {
  createElement(type) {
    assert.equal(type, "canvas");
    const calls = [];
    const ctx = {
      globalAlpha: 1,
      fillRect(x, y, width, height) {
        calls.push({x,y,width,height,color:this.fillStyle,alpha:this.globalAlpha});
      }
    };
    return {calls, setAttribute() {}, getContext: () => ctx};
  }
};
const {hair, facial, accessory, hairPixelParts, validHairGrids, portraitCanvas} =
  vm.runInNewContext(`${catalog}\n${hairCode}\n${portraitCode}\n
    ({hair:getHairReference,facial:getFacialHairReference,accessory:getPrimaryAccessoryReference,
      hairPixelParts,validHairGrids,portraitCanvas})`, {document});

const appearance = {
  skinC:"BF8C6B", hairC:"202020", fHairC:"FF00AA",
  browC:"181818", eyeC:"131009", accessories:[{headAccC:"00FFAA"}]
};
const draw = (hairId=0, facialId=0, accessoryId=0) =>
  portraitCanvas({appearance,jersey:"12"},hairPixelParts(hair(hairId),grids),
    facial(facialId),accessory(accessoryId),hair(hairId));
const colored = (canvas, color) => canvas.calls.filter(call => call.color.toLowerCase()===color);

test("all documented hairstyles render and preserve distinct silhouettes", () => {
  for (let id=0;id<=170;id++) {
    assert.ok(hair(id), `missing hairstyle ${id}`);
    const parts=hairPixelParts(hair(id),grids);
    const pixels=[...parts.frontGrid.flat(),...parts.backGrid.flat()].filter(Boolean);
    assert.equal(pixels.length===0,id===0,`hairstyle ${id}`);
  }
  const parts=id=>JSON.stringify(hairPixelParts(hair(id),grids));
  for(const [a,b] of [[1,2],[5,4],[70,1],[125,64],[153,73],[165,164],[130,112],[24,71]])
    assert.notEqual(parts(a),parts(b),`${a} and ${b}`);
});

test("the three supplied hairstyle grids are used and malformed data is rejected", () => {
  assert.equal(validHairGrids(grids),true);
  assert.equal(validHairGrids({...grids,"high-top fade":[]}),false);
  for(const [id,name] of [[26,"dreadlocks shoulder length"],[50,"high-top fade"],[70,"cornrows with bun"]])
    assert.equal(JSON.stringify(hairPixelParts(hair(id),grids).frontGrid),JSON.stringify(grids[name]));
});

test("all facial-hair selections draw at the lower face and differ from clean shaven", () => {
  assert.equal(colored(draw(), "#ff00aa").length,0);
  const styles=new Set();
  for(let id=1;id<=31;id++) {
    const strokes=colored(draw(0,id),"#ff00aa");
    assert.ok(strokes.length,`empty facial hair ${id}`);
    assert.ok(strokes.every(p=>p.y>=136 && p.y+p.height<=189),`facial hair ${id} is misplaced`);
    styles.add(JSON.stringify(strokes));
  }
  assert.equal(styles.size,31,"facial-hair IDs should have distinct drawings");
  assert.notDeepEqual(colored(draw(0,1),"#ff00aa"),colored(draw(0,4),"#ff00aa"));
  assert.notDeepEqual(colored(draw(0,5),"#ff00aa"),colored(draw(0,4),"#ff00aa"));
});

test("all head accessories render in the head area; eyewear keeps transparent lenses", () => {
  assert.equal(colored(draw(), "#00ffaa").length,0);
  for(let id=1;id<=25;id++) {
    const strokes=colored(draw(0,0,id),"#00ffaa");
    assert.ok(strokes.length,`empty accessory ${id}`);
    assert.ok(strokes.every(p=>p.y>=55 && p.y+p.height<=161),`accessory ${id} is misplaced`);
  }
  for(const id of [4,5,6,7,10,15,24,25])
    assert.ok(colored(draw(0,0,id),"#00ffaa").some(p=>p.alpha>0&&p.alpha<1),`eyewear ${id}`);
  assert.notDeepEqual(colored(draw(0,0,7),"#00ffaa"),colored(draw(0,0,1),"#00ffaa"));
  assert.notDeepEqual(colored(draw(0,0,24),"#00ffaa"),colored(draw(0,0,25),"#00ffaa"));
});

test("hairstyles leave eyebrows uncovered and faded cuts shade the temples", () => {
  for(let id=0;id<=170;id++) {
    const calls=draw(id).calls;
    const lastBrow=calls.findLastIndex(p=>p.color==="#181818");
    const coversBrow=p=>p.y<101 && p.y+p.height>94 &&
      [[94,120],[138,164]].some(([left,right])=>p.x<right && p.x+p.width>left);
    assert.ok(lastBrow>=0);
    const overlap=calls.slice(lastBrow+1).find(coversBrow);
    assert.ok(!overlap,`hairstyle ${id} covers the eyebrows: ${JSON.stringify(overlap)}`);
  }
  const parts=hairPixelParts(hair(50),grids);
  const render=ref=>portraitCanvas({appearance},parts,facial(0),accessory(0),ref).calls;
  assert.notDeepEqual(render(hair(50)),render(hair(51)));
  const fade=render(hair(50)).filter(p=>p.y>=90 && p.y<122 && p.width===1 && p.height===1 && p.color==="#202020");
  assert.ok(new Set(fade.map(p=>p.alpha)).size>=30,"fade should blend gradually into skin");
  assert.ok(fade.some(p=>p.alpha<.1) && fade.some(p=>p.alpha>.9));
});

test("the tapered cut follows the close-crop outline above its fading temples", () => {
  const top=id=>{
    const calls=draw(id).calls;
    const lastBrow=calls.findLastIndex(p=>p.color==="#181818");
    return calls.slice(lastBrow+1).filter(p=>p.y<90);
  };
  assert.deepEqual(top(90),top(1));
});

test("low-volume cropped styles fit the scalp instead of projecting over the temples", () => {
  const bald=draw().calls;
  for(let id=1;id<=170;id++) {
    const ref=hair(id);
    if(ref.volume!=="low" || !/crop/.test(`${ref.structure} ${ref.description}`.toLowerCase())) continue;
    const calls=draw(id).calls;
    const lastBrow=calls.findLastIndex(p=>p.color==="#181818");
    for(let y=75;y<90;y++) {
      const head=bald.find(p=>p.y===y && p.height===1 && p.color==="#BF8C6B");
      for(const stroke of calls.slice(lastBrow+1).filter(p=>p.y===y))
        assert.ok(stroke.x>=head.x && stroke.x+stroke.width<=head.x+head.width,`crop ${id} overhangs at ${y}`);
    }
  }
});

test("the high-top fade is a slightly taller close-fitting cut", () => {
  const hairStrokes=id=>{
    const calls=draw(id).calls;
    const lastBrow=calls.findLastIndex(p=>p.color==="#181818");
    return calls.slice(lastBrow+1).filter(p=>["#202020","#1b1b1b","#252525"].includes(p.color));
  };
  const crop=hairStrokes(1), highTop=hairStrokes(50);
  const cropTop=Math.min(...crop.map(p=>p.y));
  const highTopTop=Math.min(...highTop.map(p=>p.y));
  assert.ok(highTopTop<cropTop && cropTop-highTopTop<=12);
  assert.ok(highTop.filter(p=>p.y===highTopTop).reduce((sum,p)=>sum+p.width,0)>=76,
    "high-top should have a broad, squared top");
  assert.ok(highTop.filter(p=>p.y===70).every(p=>p.x>=80 && p.x+p.width<=176),
    "high-top should not overhang the head");
  assert.ok(hairStrokes(90).filter(p=>p.y===70).every(p=>p.x>=80 && p.x+p.width<=176),
    "short tapered cut should not overhang the head");
  assert.ok(highTop.some(p=>p.color!=="#202020"),"high-top grid retains textured shading");
});

test("the bald head has a rounded crown and tapers toward the chin", () => {
  const calls=draw().calls;
  const headAt=y=>calls.find(p=>p.y===y && p.height===1 && p.color==="#BF8C6B" && p.width>=20);
  const crown=headAt(48), forehead=headAt(75), jaw=headAt(165);
  assert.ok(crown.width<headAt(55).width && headAt(55).width<headAt(65).width);
  assert.ok(headAt(65).width<forehead.width);
  assert.ok(jaw.width<forehead.width*.7);
  for(let y=49;y<=75;y++)
    assert.ok(headAt(y).width>=headAt(y-1).width,`crown narrows at row ${y}`);
  for(let id=1;id<=170;id++) {
    const ref=hair(id);
    if(/balding|mostly exposed|mostly bald|sparse-top|central-strip/.test(`${ref.description} ${ref.structure}`.toLowerCase()))
      continue;
    const strokes=draw(id).calls;
    const scalp=strokes.findLastIndex(p=>p.y===48 && p.color==="#BF8C6B");
    assert.ok(strokes.slice(scalp+1).some(p=>p.y===48 && p.x<=crown.x && p.x+p.width>=crown.x+crown.width && p.color==="#202020"),
      `hairstyle ${id} leaves the crown exposed`);
  }
  const strip=draw(68).calls;
  const scalp=strip.findLastIndex(p=>p.y===60 && p.color==="#BF8C6B");
  assert.ok(strip.slice(scalp+1).some(p=>p.y===60 && p.color==="#202020" && p.x<=128 && p.x+p.width>128));
  assert.ok(!strip.slice(scalp+1).some(p=>p.y===60 && p.color==="#202020" && p.x<=105 && p.x+p.width>105),
    "center strip should leave the sides of the crown exposed");
});

test("portrait paints on a 256-pixel grid and keeps all drawing within the canvas", () => {
  const canvas=draw(50,4,7);
  assert.equal(canvas.width,256);
  assert.equal(canvas.height,256);
  assert.ok(canvas.calls.some(p=>p.color==="#17171d"),"jersey is painted");
  for(const p of canvas.calls) {
    assert.ok([p.x,p.y,p.width,p.height].every(Number.isInteger),JSON.stringify(p));
    assert.ok(p.x>=0 && p.y>=0 && p.x+p.width<=256 && p.y+p.height<=256,JSON.stringify(p));
  }
});

test("jersey numbers remain in player data but do not appear in the portrait", () => {
  const parts=hairPixelParts(hair(50),grids);
  const render=jersey=>portraitCanvas({appearance,jersey},parts,facial(0),accessory(0)).calls;
  assert.deepEqual(render("12"),render("99"));
  const sideTrim=render("12").filter(p=>p.color==="#dddddf");
  assert.ok(sideTrim.length && sideTrim.every(p=>p.width===5));
});

test("jersey has inward-cut sleeves and a V-shaped collar", () => {
  const calls=draw().calls;
  const jerseyAt=y=>calls.find(p=>p.y===y && p.color==="#17171d").width;
  assert.ok(jerseyAt(205)>jerseyAt(220));
  assert.ok(jerseyAt(255)>jerseyAt(220));
  const collarAt=y=>calls.find(p=>p.y===y && p.color==="#f0f0ee").width;
  assert.ok(collarAt(198)>collarAt(210));
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
  assert.equal(elements.color.style.background,"#ABCDEF");
  setChoice("hair","hair",[["0012","#12 Dense textured crop"]],"0012");
  assert.equal(elements.hair.textContent,"12");
  assert.match(elements.hair["aria-label"],/Dense textured crop/);
  setChoice("facial","facial",[["0004","#4 Beard"]],"0004");
  assert.equal(elements.facial.textContent,"4");
  setChoice("accessory","accessory",[["none","#0 No accessory"]],"none");
  assert.equal(elements.accessory.textContent,"0");
});
