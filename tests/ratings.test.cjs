const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const section = (start, end) => html.slice(html.indexOf(start), html.indexOf(end));
const context = vm.createContext({});
const api = vm.runInContext(`
  ${section("const ATTRS = ", "const POS = ")}
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  let rng = Math.random;
  const randomInteger = (min, max) => min + Math.floor(rng() * (max - min + 1));
  const dunkInput = { dataset: {} };
  const document = { getElementById: () => dunkInput };
  let bounds = {};
  const pick = items => items[Math.floor(rng() * items.length)];
  function attributeBounds(code, type) { return bounds[code + type] || [2, 20]; }
  ${section("function budgetForStars(", "function starText(")}
  ${section("function allocatePoints(", "const TIER_TARGETS = ")}
  ${section("const TIER_RULES = ", "function shuffle(")}
  ${section("function randomHalfStar(", "function generateRegressionAge(")}
  ({ budgetForStars, starsForBudget, qualityForTier, ratingStatsProfile,
     makeAttributeRatings, isReportedWomanDunker, archetypeWeights, ARCHETYPES,
     setRng(value) { rng = value; },
     setBounds(value) { bounds = value; },
     setDunkEdited(edited) { dunkInput.dataset.userModified = edited ? "true" : ""; } })
`, context);

const codes = ["LAY", "DNK", "INS", "MID", "TPT", "FTS", "DRB", "PAS", "ORE", "DRE", "STL", "BLK"];
const sum = (attrs, side) => codes.reduce((total, code) => total + attrs[code][side] - 2, 0);
const weights = codes.map(() => 1);
const quality = (potentialStars, currentStars = 5) => ({ potentialStars, currentStars });

test("potential caps and overall use the requested point scale", () => {
  for (const [stars, cap] of [[2,60], [2.5,74], [3,88], [3.5,102], [4,116], [4.5,130], [5,144]]) {
    assert.equal(api.budgetForStars(stars), cap);
    assert.equal(api.starsForBudget(cap), stars);
  }
  assert.equal(api.starsForBudget(53), 2);
});

test("rookie references influence ratings without violating caps or losing position differences", () => {
  const ref = vm.runInNewContext(
    fs.readFileSync(path.join(__dirname,"..","data/roster-reference.js"),"utf8") + "\nwindow.HOOPLAND_ROSTER_REFERENCE",
    {window:{}}
  );
  for (const [gender,key] of [["0","nba"],["1","wnba"],["1","ncaaw"]]) {
    let guardDribble=0,bigDribble=0,guardBlock=0,bigBlock=0;
    for (let i=0;i<100;i++) {
      const guard=api.makeAttributeRatings(1,gender,null,quality(3.5,3),weights,"",ref.calibration[key][0]);
      const big=api.makeAttributeRatings(7,gender,null,quality(3.5,3),weights,"",ref.calibration[key][2]);
      guardDribble+=guard.attributes.DRB[0]; bigDribble+=big.attributes.DRB[0];
      guardBlock+=guard.attributes.BLK[0]; bigBlock+=big.attributes.BLK[0];
      assert.ok(guard.attributes.DRB[1]-guard.attributes.DRB[0]>=Math.round(ref.calibration[key][0].dribbleGrowth));
      assert.ok(big.attributes.DRB[1]-big.attributes.DRB[0]>=Math.round(ref.calibration[key][2].dribbleGrowth));
      for (const result of [guard,big]) {
        assert.equal(sum(result.attributes,0),result.currentBudget);
        assert.equal(sum(result.attributes,1),result.potentialBudget);
        for(const code of codes) assert.ok(result.attributes[code][0]<=result.attributes[code][1]);
      }
    }
    assert.ok(guardDribble > bigDribble + 200, key);
    assert.ok(bigBlock > guardBlock + 200, key);
    assert.ok(guardDribble / 100 > 9, key);
    assert.ok(bigDribble / 100 > 3.5, key);
  }
});

test("all positions and tiers honor budgets, growth, and women’s dunk default", () => {
  const caps = [20,18,16,14,12,10,10,10,10];
  for (const gender of ["0", "1"]) for (let position = 0; position < 9; position++) {
    for (const stars of [2, 2.5, 3, 3.5, 4, 4.5, 5]) {
      for (let i = 0; i < 10; i++) {
        const result = api.makeAttributeRatings(position, gender, null, quality(stars), weights);
        assert.equal(sum(result.attributes, 0), result.currentBudget);
        assert.equal(sum(result.attributes, 1), result.potentialBudget);
        assert.equal(result.potentialBudget, api.budgetForStars(stars));
        assert.ok(result.currentBudget < result.potentialBudget);
        assert.ok(result.attributes.DRB[1] <= caps[position]);
        assert.ok(result.attributes.DRB[1] - result.attributes.DRB[0] >= 8);
        for (const code of codes) {
          const [current, potential] = result.attributes[code];
          assert.ok(current >= 2 && current <= potential && potential <= 20, code);
        }
        if (gender === "1") assert.deepEqual(Array.from(result.attributes.DNK), [2, 2]);
        else {
          assert.ok(result.attributes.LAY[1] >= 10);
          assert.ok(result.attributes.DNK[1] >= 8);
        }
      }
    }
  }
});

test("archetypes define position-appropriate priorities and real statistics select a fitting style", () => {
  assert.equal(api.ARCHETYPES.length,13);
  assert.ok(api.ARCHETYPES.every(style=>style.pri>=1&&style.pri<=11&&style.sec>=1&&style.sec<=11));
  for(let i=0;i<300;i++){const w=api.archetypeWeights(6,null,quality(3),"1");assert.ok(![3].includes(w.pri)&&![3].includes(w.sec)&&w.arc!=="Rim Runner");}
  const stats = {attrs:{TPT:20,FTS:20,PAS:4,ORE:3,DRE:4,STL:4,BLK:3},g:30,mpg:30};
  assert.equal(api.archetypeWeights(2,{bart:stats},quality(4)).arc,"Sharpshooter");
  const floor = api.archetypeWeights(0,{arc:"Floor General"},quality(3));
  assert.ok(floor.weights[codes.indexOf("PAS")] > floor.weights[codes.indexOf("BLK")]);
  assert.equal(api.archetypeWeights(6,{arc:"Playmaking Big"},quality(3)).arc,"Playmaking Big");
  assert.throws(()=>api.archetypeWeights(0,{arc:"GOAT"},quality(3)),/5-star/);
});

test("playmaking bigs can develop more handles than the position cap", () => {
  let exceeds = false;
  for (let i=0;i<80;i++) {
    const style=api.archetypeWeights(8,{arc:"Playmaking Big"},quality(4));
    const result=api.makeAttributeRatings(8,"0",null,quality(4,3),style.weights,style.arc);
    assert.ok(result.attributes.DRB[1] <= 12);
    if (result.attributes.DRB[1] > 10) exceeds = true;
  }
  assert.ok(exceeds);
});

test("archetype priorities change current and potential ratings within the same tier", () => {
  const sample = arc => {
    let totalCurrent = 0, totalPotential = 0;
    for (let i=0;i<100;i++) {
      const style=api.archetypeWeights(5,{arc},quality(4));
      const ratings=api.makeAttributeRatings(5,"0",null,quality(4,3),style.weights,style.arc);
      totalCurrent += ratings.attributes.TPT[0];
      totalPotential += ratings.attributes.TPT[1];
      assert.equal(sum(ratings.attributes,1),116);
    }
    return [totalCurrent,totalPotential];
  };
  const shooter=sample("Sharpshooter"), interior=sample("Post Scorer");
  assert.ok(shooter[0]>interior[0]+100);
  assert.ok(shooter[1]>interior[1]+100);
});

test("GOATs are rare, have unusually broad potential and respect women's dunk rules", () => {
  api.setRng(()=>0.0005);
  assert.equal(api.archetypeWeights(4,null,quality(5)).arc,"GOAT");
  assert.notEqual(api.archetypeWeights(4,null,quality(4.5)).arc,"GOAT");
  assert.notEqual(api.archetypeWeights(4,{fn:"Real",ln:"Player"},quality(5)).arc,"GOAT");
  api.setBounds({ TPTp:[2,12] });
  assert.notEqual(api.archetypeWeights(4,null,quality(5)).arc,"GOAT");
  api.setBounds({});
  api.setRng(Math.random);
  for (const gender of ["0","1"]) for (let i=0;i<20;i++) {
    const style=api.archetypeWeights(8,{arc:"GOAT"},quality(5));
    const result=api.makeAttributeRatings(8,gender,null,quality(5,4),style.weights,style.arc);
    assert.equal(result.potentialBudget,192);
    assert.equal(sum(result.attributes,1),192);
    assert.equal(sum(result.attributes,0),result.currentBudget);
    for (const code of codes) {
      if (gender==="1" && code==="DNK") assert.deepEqual(Array.from(result.attributes[code]),[2,2]);
      else {
        assert.ok(result.attributes[code][1]>=16,code);
        assert.ok(result.attributes[code][0]>=8,code);
      }
    }
  }
});

test("women dunk only with a sourced name and matching school, and stay below 5", () => {
  const watkins = { fn: "Ashlyn", ln: "Watkins", school: "South Carolina" };
  assert.equal(api.isReportedWomanDunker(watkins), true);
  assert.equal(api.isReportedWomanDunker({ ...watkins, school: "Stanford" }), false);
  assert.equal(api.isReportedWomanDunker({ fn: "Abby", ln: "Meyers", school: "Maryland", bart: { shotZones: true, dunksMade: 2 } }), false);
  for (let i = 0; i < 20; i++) {
    const result = api.makeAttributeRatings(6, "1", watkins, quality(4, 3), weights);
    assert.ok(result.attributes.DNK[1] <= 10);
  }
  api.setBounds({ DNKc: [2, 2], DNKp: [2, 2] });
  assert.ok(Array.from({ length: 20 }, () => api.makeAttributeRatings(6, "1", watkins, quality(4, 3), weights))
    .some(result => result.attributes.DNK[1] > 2));
  api.setDunkEdited(true);
  const limited = api.makeAttributeRatings(6, "1", watkins, quality(4, 3), weights);
  assert.deepEqual(Array.from(limited.attributes.DNK), [2, 2]);
  api.setDunkEdited(false);
  api.setBounds({});
});

test("real statistics change budgets with sample shrinkage and avoid unreliable zones", () => {
  const attrs = Object.fromEntries(codes.map(code => [code, 20]));
  const stats = { attrs, g: 30, mpg: 25, shotZones: false };
  const full = api.ratingStatsProfile(stats);
  const tiny = api.ratingStatsProfile({ ...stats, g: 1, mpg: 10 });
  assert.ok(full.score > tiny.score && tiny.score > 0.5);
  assert.ok(!full.codes.includes("DRB") && !full.codes.includes("DNK") && !full.codes.includes("LAY"));
  assert.equal(api.ratingStatsProfile(null), null);
  assert.equal(api.ratingStatsProfile({ ...stats, mpg: 0 }), null);
  const high = api.makeAttributeRatings(0, "0", { bart: stats }, quality(5), weights);
  assert.equal(high.currentBudget, 120);
  assert.equal(sum(high.attributes, 0), high.currentBudget);
  assert.equal(sum(high.attributes, 1), 144);
  const lowAttrs = Object.fromEntries(codes.map(code => [code, 2]));
  const low = api.makeAttributeRatings(0, "0", { bart: { ...stats, attrs: lowAttrs } }, quality(5), weights);
  assert.equal(low.currentBudget, 40);
});

test("draft position and professional peak determine potential, with a 2.5-star minimum", () => {
  assert.equal(api.qualityForTier("bad", {draftPick: 1}, "0").potentialStars, 5);
  assert.equal(api.qualityForTier("hof", {draftPick: 60}, "0").potentialStars, 2.5);
  assert.equal(api.qualityForTier("hof", {draftPick: 1, proPotential:{stars:2.5}}, "0").potentialStars, 2.5);
  assert.equal(api.qualityForTier("bad", {draftPick: 60, proPotential:{stars:5}}, "0").potentialStars, 5);
  for (const gender of ["0","1"]) {
    const stars = Array.from({length: 70}, (_, i) =>
      api.qualityForTier("bad", {projectedPick:i+1}, gender).potentialStars);
    for (let i=1;i<stars.length;i++) assert.ok(stars[i-1] >= stars[i]);
    assert.ok(stars.every(value => value >= 2.5));
  }
  for (let i=0;i<100;i++) assert.equal(api.qualityForTier("bad").potentialStars,2.5);
});

test("conflicting limits fail explicitly", () => {
  api.setBounds({ LAYp: [2, 9] });
  assert.throws(() => api.makeAttributeRatings(0, "0", null, quality(3, 2), weights), /limits/);
  api.setBounds({ DNKp: [2, 7] });
  assert.throws(() => api.makeAttributeRatings(0, "0", null, quality(3, 2), weights), /limits/);
  api.setBounds({ DNKp: [3, 20] });
  assert.throws(() => api.makeAttributeRatings(0, "1", null, quality(3, 2), weights), /limits/);
  api.setBounds({ LAYc: [2, 2], DNKc: [2, 2], INSc: [2, 2], MIDc: [2, 2], TPTc: [2, 2], FTSc: [2, 2], DRBc: [2, 2], PASc: [2, 2], OREc: [2, 2], DREc: [2, 2], STLc: [2, 2], BLKc: [2, 2] });
  assert.throws(() => api.makeAttributeRatings(0, "0", null, quality(5, 4), weights), /limits/);
  api.setBounds({});
});
