const {test} = require("node:test");
const assert = require("node:assert/strict");
const grids = require("../data/hairstyle-grids.json");

test("hairstyles use the requested pixel grid and wrap the forehead and temples", () => {
  for (const [name,grid] of Object.entries(grids)) {
    assert.equal(grid.length,24,name);
    for (const row of grid) {
      assert.equal(row.length,24,name);
      assert.ok(row.every(value=>Number.isInteger(value) && value>=0 && value<=3),name);
    }
    for (const color of [1,2,3]) assert.ok(grid.some(row=>row.includes(color)),name);
    for (const row of [6,7,8]) assert.ok(grid[row].slice(6,18).some(Boolean),name);
    for (const row of [9,10,11]) {
      assert.ok(grid[row][6] && grid[row][17],name);
      assert.ok(grid[row].slice(8,16).every(value=>value===0),name);
    }
  }
  const locs=grids["dreadlocks shoulder length"];
  assert.ok(locs[21].slice(0,7).some(Boolean) && locs[21].slice(17).some(Boolean));
});
