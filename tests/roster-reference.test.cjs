const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname,"..");
const html = fs.readFileSync(path.join(root,"index.html"),"utf8");
const reference = fs.readFileSync(path.join(root,"data/roster-reference.js"),"utf8");
const helpers = html.slice(html.indexOf("function rosterCalibration("),html.indexOf("function makePlayer("));
const ctx = vm.createContext({window:{},generateAutomaticTendencies:()=>({dunk:4,pass:2,block:-2})});
const api = vm.runInContext(`${reference}\n${helpers}\n({rosterCalibration,attachRosterAppearances,applyRosterAppearance,calibratedTendencies})`,ctx);

test("roster calibration distinguishes draft genders and women's college freshmen", () => {
  const men = api.rosterCalibration("0","draft",0);
  const women = api.rosterCalibration("1","draft",0);
  const college = api.rosterCalibration("1","freshman",0);
  assert.ok(men.height[0] > women.height[0]);
  assert.ok(men.attrs[1] > women.attrs[1]);
  assert.notEqual(women.current,college.current);
  assert.equal(api.rosterCalibration("0","freshman",0),null);
  const adjusted = api.calibratedTendencies({},women);
  assert.equal(adjusted.dunk,Math.round((4+women.tendencies.dunk)/2));
  assert.ok(adjusted.pass !== 2);
});

test("roster appearances require identity context and reject duplicate class names", () => {
  const fudd = {fn:"Azzi",ln:"Fudd",school:"Connecticut"};
  api.attachRosterAppearances([fudd],"1","draft",2026);
  assert.ok(fudd.rosterAppearance);
  assert.match(fudd.appearanceWarnings[0],/roster appearance/);
  const wrongYear = {fn:"Azzi",ln:"Fudd"};
  api.attachRosterAppearances([wrongYear],"1","draft",2023);
  assert.equal(wrongYear.rosterAppearance,undefined);
  const wrongSchool = {fn:"Azzi",ln:"Fudd",school:"Alabama"};
  api.attachRosterAppearances([wrongSchool],"1","draft",2023);
  assert.equal(wrongSchool.rosterAppearance,undefined);
  const college = {fn:"Ace",ln:"Austin",school:"Alabama"};
  api.attachRosterAppearances([college],"1","draft",2028);
  assert.ok(college.rosterAppearance);
  const duplicate = [{fn:"Azzi",ln:"Fudd"},{fn:"Azzi",ln:"Fudd"}];
  api.attachRosterAppearances(duplicate,"1","draft",2026);
  assert.ok(duplicate.every(p=>!p.rosterAppearance));
  const wrongGender = {fn:"Azzi",ln:"Fudd"};
  api.attachRosterAppearances([wrongGender],"0","draft",2026);
  assert.equal(wrongGender.rosterAppearance,undefined);
});

test("roster colors preserve skin segments and women's clean-shaven appearance", () => {
  const original = {skinC:"AAAAAA",hairC:"111111",fHair:"0000",accessories:[{L_Elbow:"AAAAAA",R_Elbow:"BBBBBB"}]};
  const saved = {skinC:"123456",hairC:"234567",hair:"0123",fHair:"0017"};
  const result = api.applyRosterAppearance(original,saved,"1");
  assert.equal(result.skinC,"123456");
  assert.equal(result.hair,"0123");
  assert.equal(result.fHair,"0000");
  assert.equal(result.accessories[0].L_Elbow,"123456");
  assert.equal(result.accessories[0].R_Elbow,"BBBBBB");
  assert.equal(api.applyRosterAppearance(original,saved,"0").fHair,"0017");
});
