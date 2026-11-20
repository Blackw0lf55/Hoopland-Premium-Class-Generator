"use strict";

const HAIR_TEMPLATE_IDS = {
  26: "dreadlocks shoulder length",
  50: "high-top fade",
  70: "cornrows with bun"
};

function validHairGrids(grids) {
  return [...new Set(Object.values(HAIR_TEMPLATE_IDS))].every(name =>
    Array.isArray(grids?.[name]) && grids[name].length === 24 &&
    grids[name].every(row => Array.isArray(row) && row.length === 24 &&
      row.every(value => Number.isInteger(value) && value >= 0 && value <= 3)));
}

function hairPixelParts(ref, grids) {
  const empty = () => Array.from({length:24}, () => Array(24).fill(0));
  if (!ref || ref.id === 0) return {backGrid:empty(), frontGrid:empty()};
  const front = empty(), back = empty();
  const text = `${ref.structure || ""} ${ref.description || ""}`.toLowerCase();
  const texture = ref.texture || "straight", length = ref.length || "short";
  const braided = texture === "braided" || texture === "loc-like";
  const tied = /bun|knot|ponytail|tail|gathered|bunch/.test(text);
  const side = /side|asymmetr/.test(text);
  const volume = {low:0, medium:1, high:2, "very-high":3}[ref.volume] ?? 1;
  const put = (grid,x,y,value) => {
    if (x >= 0 && x < 24 && y >= 0 && y < 24) grid[y][x] = value;
  };
  const fill = (grid,x0,y0,x1,y1,value) => {
    for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) put(grid,x,y,value);
  };
  const template = grids && grids[HAIR_TEMPLATE_IDS[ref.id]];

  if (template) {
    for (let y=0;y<24;y++) for (let x=0;x<24;x++) {
      if (template[y][x]) put(front,x,y,template[y][x]);
    }
    if (ref.id === 70) {
      const locs = grids["dreadlocks shoulder length"];
      for (let y=9;y<22;y++) for (let x=0;x<24;x++) {
        if (x < 7 || x > 16) put(back,x,y,locs[y][x]);
      }
    }
  } else if (/balding|mostly exposed|mostly bald|sparse-top/.test(text)) {
    fill(front,6,9,6,11,2); fill(front,17,9,17,11,2);
    if (/sparse-top/.test(text)) fill(front,10,5,13,5,1);
    if (/tail/.test(text)) fill(back,17,9,19,19,1);
  } else {
    const top = length === "very-short" ? 5 : volume >= 2 ? 2 : volume === 1 ? 4 : 5;
    const broad = volume >= 2 && /large|halo|broad|wide|full|afro/.test(text);
    const left = broad ? 3 : 5, right = 23-left;
    const flat = /flat|square/.test(text);
    for (let y=top;y<=8;y++) {
      const inset = flat ? 0 : y === top ? 2 : y === top+1 ? 1 : 0;
      for (let x=left+inset;x<=right-inset;x++) {
        let value = x === left+inset || x === right-inset || y === top ? 2 : 1;
        if (value === 1 && (braided || texture !== "straight")) {
          if (braided && (x+y)%3 === 0) value=2;
          else if ((x*3+y*5)%11 === 0) value=3;
        }
        put(front,x,y,value);
      }
    }
    fill(front,6,9,6,11,2); fill(front,17,9,17,11,2);
    if (/spik|pointed|upright|crest|mohawk/.test(text)) {
      const start = /crest|mohawk|central-strip/.test(text) ? 10 : left+1;
      const end = /crest|mohawk|central-strip/.test(text) ? 13 : right-1;
      for (let x=start;x<=end;x+=3) {
        const height = side && x > 11 ? 2 : 1 + (x%2);
        fill(front,x,Math.max(0,top-height),x,top,2);
        put(front,x,Math.max(0,top-height+1),1);
      }
    }
    if (/center|curtain|symmetrical/.test(ref.structure || "")) {
      fill(front,8,9,10,10,1); fill(front,13,9,15,10,1);
      fill(front,11,7,12,9,0);
    } else if (/sweep|swept|fringe|part|combed|angular/.test(text)) {
      for (let x=7;x<=16;x++) {
        const y=8+(x<11?2:x<14?1:0);
        put(front,x,y,1);
      }
      if (/part|separat/.test(text)) for(let y=5;y<=7;y++) put(front,14-y+5,y,2);
    } else if (/front|hanging|face-framing/.test(text)) {
      for(let x=8;x<=15;x+=3) fill(front,x,8,x+1,10,1);
    }
    if (!tied && (length === "long" || length === "medium")) {
      const end = length === "long" ? 20 : 15;
      for (let y=8;y<=end;y++) {
        for (const x of [3,4,5,18,19,20]) {
          if (side && x<6 && y>13) continue;
          put(back,x,y,braided && (x+y)%3===0 ? 2 : (x===3||x===20 ? 2 : 1));
        }
      }
    }
    if (/double|two/.test(text) && /bun|puff|bunch|section/.test(text)) {
      fill(back,3,1,7,4,2); fill(back,4,2,6,3,1);
      fill(back,16,1,20,4,2); fill(back,17,2,19,3,1);
    } else if (/bun|knot/.test(text)) {
      const x=side?15:10;
      fill(back,x,0,x+5,3,2); fill(back,x+1,1,x+4,2,1);
    }
    if (/ponytail|tail|gathered/.test(text)) {
      fill(back,18,6,20,18,2); fill(back,19,7,19,17,1);
    }
  }
  if (ref.structure === "central-strip") {
    for (let y=0;y<24;y++) for (let x=0;x<24;x++) {
      if (x<10 || x>13) front[y][x]=0;
    }
  }
  return {backGrid:back, frontGrid:front};
}
