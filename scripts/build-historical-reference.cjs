const fs = require("node:fs");

if (process.argv.length !== 3) {
  throw new Error("Usage: node scripts/build-historical-reference.cjs NBA_1965-66.json");
}

const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (!Array.isArray(data.teams)) throw new Error("Roster is missing teams.");
const players = data.teams.flatMap(team => team.roster || []);
const attributes = ["LAY","DNK","INS","MID","TPT","FTS","DRB","PAS","ORE","DRE","STL","BLK"];
const tendencies = ["dunk","floater","hook","post","twoPoint","threePoint","pumpFake","fades","pass","lob","cross","spin","step","offReb","runPlay","defReb","takeCharge","stealOnBall","stealOffBall","block"];
const mean = values => Math.round(values.reduce((sum,value) => sum + value,0) / values.length * 10) / 10;
const calibration = Array.from({length:3},(_,group) => {
  const sample = players.filter(p => p.yrs === 0 && Math.floor(p.pos / 3) === group);
  if (sample.length < 5) throw new Error(`Insufficient historical rookie data in group ${group}.`);
  const interval = field => {
    const values = sample.map(p=>p[field]).sort((a,b)=>a-b);
    if (values.some(value=>!Number.isFinite(value))) throw new Error(`Missing ${field}.`);
    return [values[Math.floor((values.length-1)*0.05)],values[Math.ceil((values.length-1)*0.95)]];
  };
  if (sample.some(p=>attributes.some(key=>!Array.isArray(p.attributes?.[key]) ||
      !p.attributes[key].every(Number.isFinite)) ||
      tendencies.some(key=>!Number.isFinite(p.tendencies?.[key])))) throw new Error("Incomplete historical ratings.");
  return {
    n:sample.length,height:interval("ht"),weight:interval("wt"),
    current:mean(sample.map(p=>attributes.reduce((sum,key)=>sum+p.attributes[key][0]-2,0))),
    dribbleGrowth:mean(sample.map(p=>p.attributes.DRB[1]-p.attributes.DRB[0])),
    attrs:attributes.map(key=>mean(sample.map(p=>p.attributes[key][0]))),
    tendencies:Object.fromEntries(tendencies.map(key=>[key,mean(sample.map(p=>p.tendencies[key]))]))
  };
});
const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
const appearances = {};
const duplicateNames = new Set();
for (const player of players) {
  const name = normalize(`${player.fn} ${player.ln}`);
  const a = player.appearance || {};
  if (!name || !["skinC","hairC"].every(key=>/^[0-9a-f]{6}$/i.test(a[key] || "")) ||
      !["hair","fHair"].every(key=>/^\d{4}$/.test(a[key] || "")) ||
      Number(a.hair)>170 || Number(a.fHair)>31) continue;
  if (name in appearances) duplicateNames.add(name);
  else appearances[name] = {skinC:a.skinC.toUpperCase(),hairC:a.hairC.toUpperCase(),hair:a.hair,fHair:a.fHair};
}
for (const name of duplicateNames) delete appearances[name];
const output = `window.HOOPLAND_HISTORICAL_REFERENCE=${JSON.stringify({season:"1965-66",calibration,appearances})};\n`;
fs.writeFileSync("data/historical-reference.js",output);
console.log(`Built historical calibration from ${calibration.reduce((sum,group)=>sum+group.n,0)} roster entries and ${Object.keys(appearances).length} appearances.`);
