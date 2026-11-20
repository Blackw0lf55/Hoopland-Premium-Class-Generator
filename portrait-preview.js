"use strict";

function portraitCanvas(player, hairParts, facial, accessory, hairReference) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  canvas.setAttribute("role","img");
  canvas.setAttribute("aria-label","Appearance mock-up");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The appearance preview requires canvas support.");
  ctx.imageSmoothingEnabled = false;
  const appearance = player.appearance;
  const color = (value, fallback) => /^[0-9a-f]{6}$/i.test(String(value || "")) ? `#${value}` : fallback;
  const tint = (hex, multiplier) => "#" + [1,3,5].map(i =>
    Math.min(255,Math.round(parseInt(hex.slice(i,i+2),16)*multiplier)).toString(16).padStart(2,"0")).join("");
  const skin = color(appearance.skinC,"#c69479");
  const skinShade = tint(skin,.88), skinLight = tint(skin,1.08);
  const hair = color(appearance.hairC,"#202020");
  const brow = color(appearance.browC,hair);
  const eye = color(appearance.eyeC,"#222222");
  const hairDescription=`${hairReference?.description || ""} ${hairReference?.structure || ""}`.toLowerCase();
  const faded=hairReference?.id===50 || /fade|taper|closely (?:cut|cropped) sides|very short sides/.test(hairDescription);
  const sparse=/balding|mostly exposed|mostly bald|sparse-top|central-strip/.test(hairDescription);
  const closeCut=hairReference?.length==="very-short" || /close[- ]?crop|taper/.test(hairDescription) ||
    (hairReference?.volume==="low" && /crop/.test(hairDescription));
  const faceHalf = y => y<=85
    ? Math.floor(48*Math.sqrt(Math.max(0,1-((85-y)/38)**2)))
    : y<=112 ? 48 : Math.floor(48*Math.sqrt(Math.max(0,1-((y-112)/63)**2)));
  const fill = (x,y,w,h,c,alpha=1) => {
    ctx.globalAlpha=alpha;
    ctx.fillStyle=c;
    ctx.fillRect(x,y,w,h);
    ctx.globalAlpha=1;
  };
  const drawHair = (grid, front=false) => {
    const palette=["",hair,tint(hair,.85),tint(hair,1.15)];
    const textureColor=tint(hair,1.22);
    if(front && hairReference?.id===50) {
      for(let y=38;y<90;y++) {
        const half=y===38 ? 42 : y===39 ? 45 : y===40 ? 47 : 48;
        const left=128-half, right=128+half;
        for(let x=left;x<right;) {
          const end=Math.min(right,80+(Math.floor((x-80)/4)+1)*4);
          const value=grid[2+Math.floor((y-38)*6/52)][Math.max(0,Math.min(23,Math.floor((x-80)/4)))];
          fill(x,y,end-x,1,palette[value] || hair);
          x=end;
        }
      }
      return;
    }
    for (let y=0;y<24;y++) for (let x=0;x<24;x++) {
      const value=grid[y][x];
      if (!value) continue;
      const has = (dx,dy) => Boolean(grid[y+dy]?.[x+dx]);
      for (let py=0;py<8;py++) {
        let left=0, right=8;
        if (py<2 && !has(0,-1)) {
          if(!has(-1,0))left=2-py;
          if(!has(1,0))right=6+py;
        }
        if (py>5 && !has(0,1)) {
          if(!has(-1,0))left=py-5;
          if(!has(1,0))right=13-py;
        }
        const row=18+y*8+py;
        let segments=[[32+x*8+left,32+x*8+right]];
        if(front && closeCut && row>=47 && row<=120) {
          const half=faceHalf(row);
          segments=segments.map(([start,end])=>[Math.max(start,128-half),Math.min(end,128+half)])
            .filter(([start,end])=>start<end);
        }
        if(front && faded && row>=90)
          segments=segments.map(([start,end])=>[Math.max(start,96),Math.min(end,160)])
            .filter(([start,end])=>start<end);
        if(front && row>=94 && row<121) {
          for(const [a,b] of [[94,120],[138,164]]) {
            segments=segments.flatMap(([start,end])=>
              end<=a || start>=b ? [[start,end]] :
                [[start,Math.min(end,a)],[Math.max(start,b),end]].filter(([l,r])=>l<r));
          }
        }
        for(const [start,end] of segments) {
          fill(start,row,end-start,1,palette[value]);
          if(hairReference?.texture && hairReference.texture!=="straight" &&
            (x*7+y*11+py*3)%17===0 && end-start>=3)
            fill(start+1,row,2,1,textureColor);
        }
      }
    }
  };
  const drawFacial = ref => {
    if (!ref || ref.id===0) return;
    const text=ref.tags.join(" "), description=ref.description.toLowerCase();
    const beard=/beard|jaw|rounded|dense|cheek|broad/.test(text) && !/goatee|chin-beard/.test(text);
    const c=color(appearance.fHairC,hair);
    if (beard) {
      const wide=/full|large|broad|cheek/.test(text);
      const long=/long|extended|large/.test(text);
      const settings={
        2:[30,169,175],3:[39,160,176],4:[45,157,188],
        12:[33,158,176],13:[35,163,176],16:[36,166,176],17:[30,165,174],
        19:[41,163,176],20:[44,160,176],21:[43,162,176],22:[43,160,185],
        23:[24,167,186],24:[46,155,188],28:[35,167,176],29:[39,162,176],
        30:[44,162,176],31:[45,159,186]
      };
      const [width,upper,bottom]=settings[ref.id] || [wide?45:37,wide?160:166,long?188:176];
      for (let y=136;y<=bottom;y++) {
        let headWidth=y<=176 ? faceHalf(y) : 0;
        if(bottom>176 && y>=160) headWidth=Math.max(headWidth,Math.round(8+20*(bottom-y)/(bottom-160)));
        const half=Math.min(width,headWidth);
        const inner=Math.max(0,Math.ceil((upper-y)/.55));
        if (inner>0 && inner<half) {
          fill(128-half,y,half-inner,1,c);
          fill(128+inner,y,half-inner,1,c);
        } else if (!inner) {
          fill(128-half,y,half*2,1,c);
        }
      }
      if(/around the mouth|full|dense/.test(description)) fill(109,138,38,5,c);
      for (let x=108;x<=148;x+=8) fill(x,bottom-5,3,1,tint(c,1.15));
    } else if (/chin|goatee|patch|angular|minimal/.test(text)) {
      const small=/small|minimal|compact/.test(text);
      const widths={1:15,5:20,6:16,7:24,8:15,9:18,10:14,11:11,14:12,15:9,18:10,25:18,26:15,27:22};
      const bottoms={1:171,5:173,6:171,7:174,8:180,9:185,10:177,11:171,14:170,15:167,18:169,25:173,26:183,27:174};
      const width=widths[ref.id] || (small?15:24);
      const bottom=bottoms[ref.id] || (/long|pointed/.test(text)?185:175);
      for(let y=160;y<=bottom;y++){
        const w=Math.max(3,Math.round(width*(1-.5*(y-160)/(bottom-160))));
        fill(128-Math.floor(w/2),y,w,1,c);
      }
      if(/connected/.test(text)) {fill(104,141,4,22,c);fill(148,141,4,22,c);}
    }
    if (/mustache/.test(text)) {
      const width=/small|minimal/.test(text)?23:/narrow|thin/.test(text)?30:40;
      fill(128-Math.floor(width/2),138,width,/thin/.test(text)?3:5,c);
    }
  };
  const drawAccessory = ref => {
    if (!ref || ref.id===0) return;
    const id=ref.id, set=appearance.accessories?.[0] || {};
    const c=color(set.headAccC,"#ffffff"), frame="#17131a";
    const band=(y,h) => {
      fill(79,y,98,h,frame);
      fill(81,y+2,94,Math.max(1,h-4),c);
    };
    const glasses=(y,h) => {
      fill(91,y+2,74,h-4,c,.42);
      fill(89,y,78,2,frame);fill(89,y+h-2,78,2,frame);
      fill(89,y+2,2,h-4,frame);fill(165,y+2,2,h-4,frame);
      fill(125,y+2,6,3,frame);
      fill(83,y+5,6,2,frame);fill(167,y+5,6,2,frame);
    };
    if(id===1||id===18)band(83,8);
    else if(id===2){band(81,14);fill(176,87,7,23,c);fill(182,104,8,11,c);}
    else if(id===3){band(68,27);fill(176,84,8,21,c);}
    else if(id===4)glasses(105,17);
    else if(id===5||id===24)glasses(108,14);
    else if(id===6)glasses(103,21);
    else if(id===7){glasses(101,25);fill(114,98,3,40,c);fill(139,98,3,40,c);fill(102,131,52,3,c);}
    else if(id===8){fill(96,102,64,28,c,.45);fill(121,117,14,24,c,.65);}
    else if(id===9){band(64,31);fill(114,58,28,8,c);}
    else if(id===10){fill(137,103,30,24,frame);fill(140,106,24,18,c,.5);}
    else if(id===11){band(76,17);fill(76,91,104,4,frame);}
    else if(id===12){fill(82,60,92,32,c);fill(174,77,8,16,c);}
    else if(id===13){fill(70,103,12,29,c);fill(174,103,12,29,c);}
    else if(id===14||id===23)band(79,20);
    else if(id===15||id===25)glasses(102,id===25?30:24);
    else if(id===16)fill(175,127,5,8,c);
    else if(id===17){fill(96,133,64,27,frame);fill(99,136,58,21,c);}
    else if(id===19)band(79,11);
    else if(id===20)band(75,14);
    else if(id===21)band(80,14);
    else if(id===22){band(76,18);fill(76,82,5,12,c);fill(175,82,5,12,c);}
  };

  drawHair(hairParts.backGrid);
  for (let y=190;y<256;y++) {
    const half=Math.min(110,Math.floor(25+Math.sqrt(y-190)*11));
    fill(128-half,y,half*2,1,y>234?skinShade:skin);
  }
  fill(108,158,40,47,skinShade);
  fill(112,160,32,42,skin);

  for (let y=190;y<256;y++) {
    const shoulderHalf=Math.min(110,Math.floor(25+Math.sqrt(y-190)*11));
    const half=y<=200 ? shoulderHalf : y<=220
      ? Math.round(59-9*(1-((220-y)/20)**2))
      : Math.round(50+(y-220)*.9);
    fill(128-half,y,half*2,1,"#17171d");
    if (y>205) {
      fill(128-half+4,y,5,1,"#dddddf");
      fill(128+half-9,y,5,1,"#dddddf");
    }
    if (y>216) fill(128-half+11,y,2,1,"#29292f");
  }
  for (let y=190;y<=219;y++) {
    const shoulderHalf=Math.min(110,Math.floor(25+Math.sqrt(y-190)*11));
    const half=y<=200 ? shoulderHalf : Math.round(59-9*(1-((220-y)/20)**2));
    const outer=Math.min(half-4,Math.round(36*(219-y)/29));
    const inner=Math.max(0,outer-7);
    fill(128-outer,y,outer*2,1,"#f0f0ee");
    if (inner) fill(128-inner,y,inner*2,1,skin);
  }
  for (const center of [78,178]) {
    for(let y=101;y<=132;y++){
      const w=Math.round(8*Math.sqrt(Math.max(0,1-((y-116)/16)**2)));
      fill(center-w,y,w*2,1,skinShade);
      if(w>2)fill(center-w+2,y,w*2-4,1,skin);
    }
  }
  for (let y=47;y<=177;y++) {
    const half=faceHalf(y);
    if (half) fill(128-half,y,half*2,1,skin);
  }
  for (let y=89;y<=153;y++) {
    const half=faceHalf(y);
    if (half>6) {
      fill(128-half+3,y,2,1,skinShade,.35);
      fill(128+half-5,y,2,1,skinShade,.35);
    }
  }
  fill(95,87,5,20,skinLight,.35);
  fill(122,119,4,22,skinShade,.35);
  fill(125,139,8,2,skinShade,.55);
  drawFacial(facial);
  fill(113,153,30,3,tint(skin,.6));
  fill(115,156,26,2,skinLight,.35);
  for (const x of [95,139]) {
    fill(x,109,22,12,"#f9f8f3");
    fill(x+9,109,10,12,eye);
    fill(x+12,110,3,3,"#ffffff",.7);
    fill(x-1,96,24,5,brow);
    fill(x+1,94,20,2,brow);
  }
  if(hairReference && hairReference.id!==0 && !sparse) {
    for(let y=47;y<=75;y++) {
      const half=faceHalf(y);
      if(half) fill(128-half,y,half*2,1,hair);
    }
  } else if(hairReference?.structure==="central-strip") {
    for(let y=47;y<67;y++) {
      const half=Math.min(16,faceHalf(y));
      if(half) fill(128-half,y,half*2,1,hair);
    }
  }
  drawHair(hairParts.frontGrid,true);
  if(faded) {
    for(let y=90;y<122;y++) {
      const half=faceHalf(y);
      for(let d=0;d<16;d++) {
        const opacity=((122-y)/32)**1.2;
        const left=128-half+d, right=128+half-1-d;
        if(y<94 || left<94) fill(left,y,1,1,hair,opacity);
        if(y<94 || right>=164) fill(right,y,1,1,hair,opacity);
      }
    }
  }
  drawAccessory(accessory);
  return canvas;
}
