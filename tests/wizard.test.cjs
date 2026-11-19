const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const start = html.indexOf("  function render(){", html.indexOf("const box=$(\"hlQuestions\")"));
const end = html.indexOf("  function showPage(", start);
const renderCode = html.slice(start, end);

test("class feedback keeps important limitations without routine generation details", () => {
  const code = html.slice(html.indexOf("function classResultMessage("), html.indexOf("async function generateClass()"));
  const {classResultMessage, playerEditNotice, updatePlayerDimension} = vm.runInNewContext(code + "\n({classResultMessage, playerEditNotice, updatePlayerDimension})");
  assert.equal(classResultMessage(0, false, ""), "");
  const warning = "Prior draft results could not be verified; previously drafted players may appear.";
  assert.equal(classResultMessage(3, true, warning),
    `3 fictional players added. Some appearances are estimates; please review them. ${warning}`);
  assert.equal(playerEditNotice(["Community-approved edits override the baseline.", "Hair style was not identified and is a placeholder."]), "");
  assert.equal(playerEditNotice(["Shared appearance lookup failed: timeout", "Shared attribute lookup failed: timeout"]),
    "Saved edits could not be loaded.");
  assert.equal(playerEditNotice(["Some shared attribute edits were incompatible with this player or era and were not applied.",
    "The imported appearance baseline is invalid and was not applied."]), "Some saved edits could not be applied.");
  assert.match(classResultMessage(0,false,"",2),/2 real players have estimated height or weight/);
  const player={ht:86,wt:200,estimatedDimensions:{ht:true,wt:true}};
  assert.equal(updatePlayerDimension(player,"ht","81"),true);
  assert.deepEqual(player,{ht:81,wt:200,estimatedDimensions:{ht:false,wt:true}});
  assert.equal(updatePlayerDimension(player,"wt",""),false);
  assert.equal(updatePlayerDimension(player,"wt","220.5"),false);
  assert.equal(player.wt,200);
});

test("rerendering setup preserves the class size input and its value", () => {
  class Element {
    constructor() {
      this.children = [];
      this.parent = null;
      this.style = {};
      this.dataset = {};
    }
    appendChild(child) {
      if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
      this.children.push(child);
      child.parent = this;
    }
    contains(child) {
      return this.children.some(item => item === child || item.contains(child));
    }
    before(child) { this.parent.appendChild(child); }
    set innerHTML(value) {
      for (const child of this.children) child.parent = null;
      this.children = [];
      if (value) {
        this.label = new Element();
        this.valueElement = new Element();
        this.arrows = [new Element(), new Element()];
        this.arrows.forEach((arrow, index) => { arrow.dataset.d = index ? "-1" : "1"; });
        [this.label, this.valueElement, ...this.arrows].forEach(child => this.appendChild(child));
      }
    }
    querySelector(selector) { return selector === ".hl-q-label" ? this.label : this.valueElement; }
    querySelectorAll() { return this.arrows; }
    addEventListener() {}
  }
  const root = new Element(), box = new Element(), home = new Element();
  const input = new Element(), plus = new Element(), next = new Element();
  input.value = "73";
  root.appendChild(box);
  root.appendChild(home);
  home.appendChild(input);
  home.appendChild(plus);
  const elements = { classSize: input, classSizePlus: plus };
  const context = vm.createContext({
    box, next, revealed: 5,
    document: { createElement: () => new Element() },
    $: id => root.contains(elements[id]) ? elements[id] : null,
    order: () => [
      ...Array.from({ length: 4 }, () => ({ label: "Option", text: () => "Value" })),
      { label: "Class Size", input: true }
    ]
  });
  vm.runInContext(renderCode + "\nrender(); render();", context);
  assert.ok(root.contains(input));
  assert.ok(box.contains(input));
  assert.equal(input.value, "73");
});

test("export validation identifies null, non-finite, missing and sparse values", () => {
  const start = html.indexOf("  function invalidExportValue(value, path)");
  const end = html.indexOf("  const invalidPath =", start);
  const validate = vm.runInNewContext(html.slice(start, end) + "\ninvalidExportValue");
  assert.equal(validate({ players: [{ attributes: [2, 3] }] }, "class"), "");
  assert.equal(validate({ player: { height: null } }, "class"), "class.player.height");
  assert.equal(validate({ attr: [NaN] }, "class"), "class.attr.0");
  assert.equal(validate({ attr: [undefined] }, "class"), "class.attr.0");
  assert.equal(validate({ attr: new Array(1) }, "class"), "class.attr.0");
});

test("loading trivia always shows its answer immediately after the question", () => {
  const start = html.indexOf("  function createLoadingMessages(){");
  const end = html.indexOf('  $("hlSubmit").addEventListener', start);
  const create = vm.runInNewContext(html.slice(start, end) + "\ncreateLoadingMessages");
  const next = create();
  const messages = Array.from({ length: 40 }, () => next());
  const question = "What team does Polan Stronk play for?";
  const answer = "Answer: LA Stars.";
  assert.ok(messages.includes(question));
  assert.ok(messages.includes("Giving KoalityGame a back rub..."));
  assert.ok(messages.includes("Browsing Hoop Land Discord..."));
  messages.forEach((message, index) => {
    if (message === question && index + 1 < messages.length) assert.equal(messages[index + 1], answer);
    if (message === answer && index > 0) assert.equal(messages[index - 1], question);
  });
});

test("actual and potential limits change by half steps and render both halves", () => {
    const code=html.slice(html.indexOf("function buildInputs()"),html.indexOf("function attributeBounds("));
    const elements={}, handlers={};
    const element=()=>({children:[],dataset:{},style:{values:{},setProperty(k,v){this.values[k]=v}},
      classList:{add(){}},appendChild(child){this.children.push(child);},addEventListener(type,fn){handlers[type]=fn},
      set innerHTML(text){this.children=[];for(const m of text.matchAll(/id="([^"]+)"[^>]*value="([^"]*)"/g))elements[m[1]]={value:m[2],dataset:{}};
        for(const m of text.matchAll(/id="([^"]+)(?:LimitBar|cmaxValue|pmaxValue)"/g)){
          const id=m[0].slice(4,-1);elements[id]=element();
        }}});
    elements.attrGrid=element();
    elements.gender={value:"0",addEventListener(){}};
    const context=vm.createContext({ATTRS:[["LAY","Layup"]],document:{getElementById:id=>elements[id],createElement:()=>element()},
      window:{},clamp:(v,a,b)=>Math.max(a,Math.min(b,v))});
    vm.runInContext(code+"\nbuildInputs()",context);
    const click=(side,delta)=>handlers.click({target:{closest:()=>({dataset:{code:"LAY",side,delta:String(delta)}})}});
    click("actual",-1);
    assert.equal(Number(elements.LAYcmax.value),19);
    assert.equal(elements.LAYcmaxValue.textContent,"9.5");
    assert.deepEqual(elements.LAYLimitBar.children[9].style.values,{"--limit-left":"#09bf60","--limit-right":"#030712"});
    click("potential",-1);
    assert.equal(Number(elements.LAYpmax.value),19);
    assert.deepEqual(elements.LAYLimitBar.children[9].style.values,{"--limit-left":"#09bf60","--limit-right":"transparent"});
});

test("country chances use NBA counts, retain a fallback and redistribute selected weights", () => {
  const countriesCode = html.slice(html.indexOf("const NBA_COUNTRY_COUNTS = {"), html.indexOf("const NAMES = {"));
  const choiceCode = html.slice(html.indexOf("function weightedChoice("), html.indexOf("function budgetForStars("));
  const api = vm.runInNewContext(`${countriesCode}
    let seed=12345;
    function rng(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
    ${choiceCode}
    ({countries:COUNTRIES, chances:countryChances, weights:selectedCountryWeights, choose:weightedChoice})`);
  const weights = new Map(api.countries);
  assert.equal(weights.get("US"), 394);
  assert.equal(weights.get("FR"), 17);
  assert.equal(weights.get("CA"), 16);
  assert.equal(weights.get("NG"), 6);
  assert.equal(weights.get("ES"), 5);
  assert.equal(weights.get("JP"), 1);
  assert.equal(weights.get("IN"), 0.1);
  const enabled = new Set(weights.keys());
  const full = api.chances(enabled);
  assert.ok(Math.abs([...full.values()].reduce((a,b)=>a+b,0)-1)<1e-12);
  assert.ok([...full.values()].every(chance=>chance>0));
  enabled.delete("US");
  enabled.delete("FR");
  const chances = api.chances(enabled);
  assert.equal(chances.get("US"), 0);
  assert.equal(chances.get("FR"), 0);
  assert.ok(Math.abs(chances.get("CA") / chances.get("IN") - 160)<1e-10);
  const counts = new Map();
  for(let i=0;i<50000;i++){
    const country=api.choose(api.weights(enabled));
    counts.set(country,(counts.get(country)||0)+1);
  }
  assert.equal(counts.has("US"),false);
  assert.equal(counts.has("FR"),false);
  assert.ok(Math.abs(counts.get("CA")/50000-chances.get("CA"))<0.01);
  const only = api.chances(new Set(["IN"]));
  assert.equal(only.get("IN"),1);
});

test("country buttons update chances on deselection and retain one selected country", () => {
  const countriesCode = html.slice(html.indexOf("const NBA_COUNTRY_COUNTS = {"), html.indexOf("const NAMES = {"));
  const selectorCode = html.slice(html.indexOf("  const flag=code=>{"), html.indexOf("\n  let page=0;", html.indexOf("  const flag=code=>{")));
  const box = {children:[],appendChild(child){this.children.push(child);}};
  const options = {};
  const attrContinue = {};
  const mode = {value:"fictional",addEventListener(type,fn){this.change=fn;}};
  const window = {};
  const document = {createElement:()=>({
    attributes:{}, percentage:{}, classList:{toggle(){}},
    querySelector(){return this.percentage;},
    setAttribute(name,value){this.attributes[name]=value;},
    addEventListener(type,fn){this.click=fn;}
  })};
  const api = vm.runInNewContext(`${countriesCode}\n${selectorCode}\n({countries:COUNTRIES,chances:countryChances})`,
    {window,document,$:id=>({hlCountries:box,hlCountryOptions:options,hlAttrContinue:attrContinue,mode})[id]});
  const button = code => box.children[api.countries.findIndex(([c])=>c===code)];
  assert.equal(button("US").percentage.textContent,(api.chances(window.ENABLED_COUNTRIES).get("US")*100).toFixed(2)+"%");
  button("US").click();
  assert.equal(button("US").percentage.textContent,"0.00%");
  assert.equal(button("US").attributes["aria-pressed"],"false");
  assert.equal(button("CA").percentage.textContent,(api.chances(window.ENABLED_COUNTRIES).get("CA")*100).toFixed(2)+"%");
  for(const [code] of api.countries) if(code!=="IN" && window.ENABLED_COUNTRIES.has(code)) button(code).click();
  assert.equal(button("IN").percentage.textContent,"100.00%");
  button("IN").click();
  assert.equal(button("IN").attributes["aria-pressed"],"true");
  button("US").click();
  assert.equal(button("US").percentage.textContent,(394/394.1*100).toFixed(2)+"%");
  assert.equal(options.hidden,false);
  mode.value="real";
  mode.change();
  assert.equal(options.hidden,true);
  assert.equal(attrContinue.textContent,"SUBMIT CLASS");
  mode.value="fictional";
  mode.change();
  assert.equal(options.hidden,false);
  assert.equal(attrContinue.textContent,"CONTINUE ▶");
  assert.equal(button("IN").attributes["aria-pressed"],"true");
  assert.equal(button("CA").attributes["aria-pressed"],"false");
});

test("wizard titles and progress reflect country selection and real-class skipping", () => {
  const start = html.indexOf("  function showPage(n,back){");
  const end = html.indexOf('  $("hlToPage2").addEventListener',start);
  const pages = Array.from({length:6},(_,i)=>({dataset:{page:String(i)},classList:{toggle(){}}}));
  const items = Array.from({length:5},()=>({classList:{toggle(name,value){this[name]=value;}}}));
  const spec = items[2], country = items[3], elements = {
    wizardProgress:{style:{}},mode:{value:"fictional"},hlReviewProgress:{},hlScreenTitle:{}
  };
  const window = {scrollTo(){}};
  vm.runInNewContext(html.slice(start,end),{
    window,$:id=>elements[id],document:{
      querySelector:selector=>selector===".wizard-spec-step"?spec:country,
      querySelectorAll:selector=>selector.includes("#setupWizard")?pages:items
    }
  });
  window.hlShowPage(3,false);
  assert.equal(elements.hlScreenTitle.textContent,"SPEC LIMITS");
  assert.equal(items[2].classList.active,true);
  window.hlShowPage(4,false);
  assert.equal(elements.hlScreenTitle.textContent,"COUNTRY SELECTION");
  assert.equal(country.hidden,false);
  assert.equal(items[3].classList.active,true);
  window.hlShowPage(5,false);
  assert.equal(elements.hlScreenTitle.textContent,"CLASS PREVIEW");
  assert.equal(items[4].classList.active,true);
  elements.mode.value="real";
  window.hlShowPage(5,false);
  assert.equal(country.hidden,true);
  assert.equal(spec.hidden,true);
  assert.equal(elements.hlReviewProgress.innerHTML,"3<br>Review");
  assert.equal(elements.wizardProgress.style.gridTemplateColumns,"repeat(3,1fr)");
});

test("spec validation, submission errors and review back follow the selected mode", async () => {
  const start = html.indexOf("  function createLoadingMessages(){");
  const end = html.indexOf('  $("hlDownload").addEventListener',start);
  const elements = {};
  for (const id of ["hlSubmit","hlAttrContinue","hlSpecContinue","hlReviewBack","hlLoading","hlLoadingText",
    "status","className","hlResultTitle","hlResultStatus","mode"]) {
    elements[id]={style:{},classList:{add(){},remove(){},contains(name){return name==="error"&&elements.status.className.includes("error");}},
      addEventListener(type,fn){this[type]=fn;}};
  }
  elements.mode.value="fictional";
  let page=2, invalid=false, failed=false, generationCount=0;
  const window={hlShowPage(n){page=n;}};
  vm.runInNewContext(html.slice(start,end),{
    $:id=>elements[id],window,POS:[["0","PG"]],
    positionPhysicalLimits(){if(invalid)throw new Error("PG: invalid limits");},
    setStatus(text,cls){elements.status.textContent=text;elements.status.className=cls;},
    async generateClass(){generationCount++;elements.status.textContent=failed?"Generation failed":"Ready";elements.status.className=failed?"error":"ok";},
    generated:[{}],drawList(){},setInterval:()=>1,clearInterval(){},Math
  });
  elements.hlAttrContinue.click();
  assert.equal(page,3);
  invalid=true;
  elements.hlSpecContinue.click();
  assert.equal(page,3);
  assert.match(elements.status.textContent,/PG: invalid/);
  invalid=false;
  elements.hlSpecContinue.click();
  assert.equal(page,4);
  assert.equal(generationCount,0);
  failed=true;
  await elements.hlSubmit.click();
  assert.equal(page,4);
  assert.equal(elements.status.textContent,"Generation failed");
  failed=false;
  await elements.hlSubmit.click();
  assert.equal(page,5);
  elements.hlReviewBack.click();
  assert.equal(page,4);
  elements.mode.value="real";
  page=2;
  invalid=true;
  failed=true;
  elements.hlAttrContinue.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(page,2);
  assert.equal(elements.status.textContent,"Generation failed");
  failed=false;
  elements.hlAttrContinue.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(page,5);
  elements.hlReviewBack.click();
  assert.equal(page,2);
});

test("fictional fill players in real classes ignore hidden country selections", () => {
  const countriesCode = html.slice(html.indexOf("const NBA_COUNTRY_COUNTS = {"), html.indexOf("const NAMES = {"));
  const start = html.indexOf("  const country =\n  sourcePlayer");
  const countryCode = html.slice(start, html.indexOf("\nconst regionalNamePools =", start));
  const mode = {value:"fictional"};
  const context = vm.createContext({
    window:{ENABLED_COUNTRIES:new Set(["CA"])},
    document:{getElementById:()=>mode},
    weightedChoice:items=>items[0][0],
    countryFromSource:country=>country
  });
  const choose = vm.runInContext(`${countriesCode}\n(sourcePlayer)=>{${countryCode}\nreturn country}`,context);
  assert.equal(choose(null),"CA");
  mode.value="real";
  assert.equal(choose(null),"US");
  assert.equal(choose({country:"FR"}),"FR");
});
