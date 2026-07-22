/**
 * @fileoverview AD1 타일 문양 계약과 AD2 수정 산출물의 구조를 회귀 검증한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const TILE_DIR=path.join(ROOT,'assets/tiles');

test('24개 순수 문양 SVG와 PNG가 중복 없이 존재한다',()=>{const motifs=fs.readdirSync(path.join(TILE_DIR,'motifs')).filter((name)=>/^motif-\d{2}\.svg$/.test(name)).sort();const tiles=fs.readdirSync(TILE_DIR).filter((name)=>/^tile-\d{2}\.png$/.test(name)).sort();assert.equal(motifs.length,24);assert.equal(tiles.length,24);const sources=motifs.map((name)=>fs.readFileSync(path.join(TILE_DIR,'motifs',name),'utf8'));assert.equal(new Set(sources).size,24);sources.forEach((source)=>{assert.doesNotMatch(source,/<image|data:image/i);assert.match(source,/viewBox="0 0 256 320"/);});});

test('자동 에셋 검증표가 안전영역·선·고유 실루엣을 확인했다',()=>{const validation=JSON.parse(fs.readFileSync(path.join(TILE_DIR,'source/asset-validation.json'),'utf8'));assert.equal(validation.faces.length,24);assert.equal(new Set(validation.faces.map((face)=>face.name)).size,24);assert.equal(new Set(validation.faces.map((face)=>face.hash)).size,24);assert.deepEqual(validation.safeArea,[36,48,220,272]);assert.deepEqual(validation.strokeRange,[8,12]);assert.equal(validation.duplicateSilhouettes,0);validation.faces.forEach((face)=>{assert.ok(face.bounds[0]>=36&&face.bounds[1]>=48&&face.bounds[2]<=220&&face.bounds[3]<=272,`${face.faceId}: ${face.bounds}`);});});

test('3개 축소 크기의 컬러·저채도 컨택트 시트가 모두 생성됐다',()=>{for(const size of ['48x60','56x70','64x80'])for(const suffix of ['','-gray']){const file=path.join(TILE_DIR,'source',`tile-contact-sheet-${size}${suffix}.png`);assert.ok(fs.statSync(file).size>1000,file);}});
