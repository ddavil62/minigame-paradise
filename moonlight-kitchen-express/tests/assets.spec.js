/** @fileoverview 달빛 주방열차 아틀라스의 필수 매핑·파일·논리 크기 계약을 검증한다. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(readFileSync(join(root,'public/assets/sprites/moonlight-atlas.json'),'utf8'));
const ingredients=['moon_mushroom','sunset_pepper','silver_dough','lantern_leaf','comet_radish','star_noodle'];
const processes=['RAW','PREPPED','COOKED','BURNT'];
const stations=['crate','board','dough','plate_shelf','cooling_pump','brazier','steamer','pot','noodle_supply','plating','service','trash','exhaust_valve'];

/** @param {string} key 필수 프레임 키 @returns {void} */
function requireFrame(key){assert.ok(manifest.frames[key],`누락 프레임: ${key}`);}

test('atlas는 49개 필수 프레임과 상태 fallback을 모두 선언한다',()=>{
  for(const process of processes)for(const ingredient of ingredients)requireFrame(`item.${ingredient}.${process}`);
  for(const dish of ['plate.RAW','mushroom_skewer','lantern_dumpling','comet_noodle'])requireFrame(dish==='plate.RAW'?`item.${dish}`:`dish.${dish}`);
  for(const station of stations)requireFrame(`station.${station}`);
  for(const player of ['p1','p2'])for(const direction of ['down','left','up','right'])requireFrame(`crew.${player}.${direction}`);
  assert.equal(Object.keys(manifest.frames).length,49);
  assert.deepEqual(manifest.fallbacks,{PREPPING:'RAW',COOKING:'PREPPED'});
});

test('manifest image가 존재하고 모든 source rect가 선언된 atlas 격자 안에 있다',()=>{
  const dimensions={items:[896,512],stations:[768,512],crew:[512,320]};
  for(const [imageKey,relativePath] of Object.entries(manifest.images)){
    const path=join(root,'public/assets/sprites',relativePath.replace('./',''));
    assert.equal(existsSync(path),true,`${imageKey} 파일 누락`);
    assert.ok(statSync(path).size>1000,`${imageKey}가 비정상적으로 작음`);
  }
  for(const [key,frame] of Object.entries(manifest.frames)){
    const [width,height]=dimensions[frame.image];
    assert.ok(frame.x>=0&&frame.y>=0&&frame.x+frame.w<=width&&frame.y+frame.h<=height,`${key} 범위 초과`);
    assert.ok(frame.drawW>0&&frame.drawH>0,`${key} 논리 크기 누락`);
  }
});

test('세 런타임 atlas 합계는 권장 1.5MB 이하이다',()=>{
  const total=Object.values(manifest.images).reduce((sum,relativePath)=>sum+statSync(join(root,'public/assets/sprites',relativePath.replace('./',''))).size,0);
  assert.ok(total<=1_500_000,`atlas 합계 ${total}B`);
});

test('세 atlas는 승인 팔레트와 8퍼센트 안전 여백 정량 기준을 충족한다',()=>{
  assert.equal(manifest.palette.length,15);
  for(const [key,quality] of Object.entries(manifest.quality)){
    assert.ok(quality.paletteAverageDistance<=8,`${key} 평균 RGB 거리`);
    assert.ok(quality.paletteWithin15Ratio>=0.95,`${key} 거리 15 이내 비율`);
    assert.ok(quality.minimumMarginPx>=11,`${key} 최소 안전 여백`);
  }
});
