const fs = require("node:fs");

if (process.argv.length !== 5) {
  throw new Error("Usage: node scripts/build-roster-reference.cjs NBA.json WNBA.json NCAAW.json");
}

const attrs = ["LAY","DNK","INS","MID","TPT","FTS","DRB","PAS","ORE","DRE","STL","BLK"];
const tendencies = ["dunk","floater","hook","post","twoPoint","threePoint","pumpFake","fades","pass","lob","cross","spin","step","offReb","runPlay","defReb","takeCharge","stealOnBall","stealOffBall","block"];
const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
const sources = [
  {path:process.argv[2], id:"nba", gender:"0"},
  {path:process.argv[3], id:"wnba", gender:"1"},
  {path:process.argv[4], id:"ncaaw", gender:"1"}
];
const output = {calibration:{}, appearances:[]};
for (const source of sources) {
  const data = JSON.parse(fs.readFileSync(source.path,"utf8"));
  if (!Array.isArray(data.teams)) throw new Error(`Missing teams in ${source.path}`);
  const players = data.teams.flatMap(team => (team.roster || []).map(player => ({player, school:team.city})));
  const rookies = players.filter(({player:p}) => p.yrs === 0 && Number.isInteger(p.pos) && p.pos >= 0 && p.pos <= 8);
  output.calibration[source.id] = Array.from({length:3},(_,group) => {
    const sample = rookies.filter(({player:p}) => Math.floor(p.pos / 3) === group).map(({player}) => player);
    if (sample.length < 5) throw new Error(`Insufficient ${source.id} position group ${group}`);
    const mean = values => Math.round(values.reduce((a,b)=>a+b,0)/values.length*10)/10;
    const interval = field => {
      const sorted = sample.map(p=>p[field]).filter(Number.isFinite).sort((a,b)=>a-b);
      if (sorted.length !== sample.length) throw new Error(`Missing ${source.id} ${field}`);
      return [sorted[Math.floor((sorted.length-1)*0.05)],sorted[Math.ceil((sorted.length-1)*0.95)]];
    };
    for (const p of sample) {
      if (!attrs.every(k=>Array.isArray(p.attributes?.[k]) && Number.isFinite(p.attributes[k][0])) ||
          !tendencies.every(k=>Number.isFinite(p.tendencies?.[k]))) throw new Error(`Incomplete ${source.id} rookie`);
    }
    return {
      n:sample.length, height:interval("ht"), weight:interval("wt"),
      current:mean(sample.map(p=>attrs.reduce((sum,k)=>sum+p.attributes[k][0]-2,0))),
      dribbleGrowth:mean(sample.map(p=>p.attributes.DRB[1]-p.attributes.DRB[0])),
      attrs:attrs.map(k=>mean(sample.map(p=>p.attributes[k][0]))),
      tendencies:Object.fromEntries(tendencies.map(k=>[k,mean(sample.map(p=>p.tendencies[k]))]))
    };
  });
  const nameCounts = new Map();
  for (const {player:p} of players) {
    const name=normalize(`${p.fn} ${p.ln}`);
    nameCounts.set(name,(nameCounts.get(name)||0)+1);
  }
  for (const {player:p,school} of players) {
    const name=normalize(`${p.fn} ${p.ln}`);
    const a=p.appearance || {};
    if (!name || nameCounts.get(name)!==1 || !["skinC","hairC"].every(k=>/^[0-9a-f]{6}$/i.test(a[k] || "")) ||
        !["hair","fHair"].every(k=>/^\d{4}$/.test(a[k] || "")) ||
        Number(a.hair)>170 || Number(a.fHair)>31) continue;
    output.appearances.push({
      name, gender:source.gender, source:source.id, school:source.id==="ncaaw"?normalize(school):"",
      rookie:p.yrs===0,
      appearance:{skinC:a.skinC.toUpperCase(),hairC:a.hairC.toUpperCase(),hair:a.hair,
        ...(source.gender==="0"?{fHair:a.fHair}:{})}
    });
  }
}
fs.writeFileSync("data/roster-reference.js",`window.HOOPLAND_ROSTER_REFERENCE=${JSON.stringify(output)};\n`);
console.log(`Built calibration and ${output.appearances.length} appearance references`);
