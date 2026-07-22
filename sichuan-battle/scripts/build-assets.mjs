/**
 * @fileoverview GPT 공용 타일 몸체와 24개 고유 사물 SVG를 합성하고 축소 검수표를 생성한다.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'assets/tiles/source/tile-shell-alpha.png');
const TILE_DIR = path.join(ROOT, 'assets/tiles');
const MOTIF_DIR = path.join(TILE_DIR, 'motifs');
const PALETTE = new Set(['#FFD97A','#786EA8','#62D6E8','#344B68','#64DC96','#FF8D78','#FFB454','#F5E9C9']);
const COMMON = 'stroke-linecap="round" stroke-linejoin="round"';

/** AD1의 faceId 계약을 그대로 따르는 순수 문양 본문. */
const MOTIFS = [
  { name:'sun', body:`<g fill="#FFD97A" stroke="#344B68" stroke-width="10" ${COMMON}><circle cx="128" cy="160" r="34"/>${Array.from({length:12},(_,i)=>{const a=i*Math.PI/6;return `<path d="M${(128+Math.cos(a)*52).toFixed(1)} ${(160+Math.sin(a)*52).toFixed(1)} L${(128+Math.cos(a)*72).toFixed(1)} ${(160+Math.sin(a)*72).toFixed(1)}"/>`;}).join('')}</g>` },
  { name:'crescent', body:`<g fill="#786EA8" stroke="#786EA8" stroke-width="10" ${COMMON}><path d="M151 82 A82 82 0 1 0 151 238 A64 64 0 0 1 151 82Z"/><circle cx="181" cy="116" r="7"/><circle cx="194" cy="143" r="5"/></g>` },
  { name:'north-star', body:`<polygon fill="#62D6E8" stroke="#62D6E8" stroke-width="8" ${COMMON} points="128,62 143,132 190,108 156,151 202,160 156,169 190,212 143,188 128,258 113,188 66,212 100,169 54,160 100,151 66,108 113,132"/>` },
  { name:'cloud', body:`<path fill="#F5E9C9" stroke="#344B68" stroke-width="10" ${COMMON} d="M59 190 C43 190 43 164 65 160 C63 132 94 116 116 132 C132 96 181 109 180 143 C212 143 219 183 190 193 L79 193 L64 208 L92 198"/>` },
  { name:'mountain', body:`<g fill="none" stroke="#786EA8" stroke-width="11" ${COMMON}><path d="M48 224 L92 126 L119 178 L153 82 L208 224Z"/><path d="M132 124 L153 82 L177 127 L159 116 L145 126Z"/></g>` },
  { name:'river', body:`<g fill="none" stroke="#62D6E8" stroke-width="11" ${COMMON}><path d="M49 112 C82 82 111 143 144 112 S192 86 207 103"/><path d="M49 160 C82 130 111 191 144 160 S192 134 207 151"/><path d="M49 208 C82 178 111 239 144 208 S192 182 207 199"/></g>` },
  { name:'pine', body:`<g fill="none" stroke="#64DC96" stroke-width="11" ${COMMON}><path d="M105 243 C112 201 126 146 151 80"/><path d="M137 112 L88 97 M132 128 L178 108 M124 151 L67 139 M120 169 L181 145 M113 193 L69 188 M108 211 L160 185"/></g>` },
  { name:'bamboo', body:`<g fill="none" stroke="#64DC96" stroke-width="10" ${COMMON}><path d="M126 247 L132 74 M113 126 L144 126 M111 181 L141 181"/><path fill="#64DC96" d="M116 113 C82 104 76 82 76 82 C106 79 119 92 116 113Z M143 143 C174 128 190 140 190 140 C170 163 151 163 143 143Z M112 197 C78 188 67 204 67 204 C91 223 108 217 112 197Z M141 94 C168 70 186 78 186 78 C175 108 156 115 141 94Z"/></g>` },
  { name:'plum', body:`<g fill="#FF8D78" stroke="#FF8D78" stroke-width="9" ${COMMON}><circle cx="128" cy="160" r="16"/><path d="M128 144 C93 122 99 91 128 116 C157 91 163 122 128 144Z M144 160 C166 125 197 132 172 160 C197 188 166 195 144 160Z M128 176 C163 198 157 229 128 204 C99 229 93 198 128 176Z M112 160 C90 195 59 188 84 160 C59 132 90 125 112 160Z M118 146 C105 110 130 91 137 128Z"/></g>` },
  { name:'lotus', body:`<g fill="none" stroke="#FF8D78" stroke-width="10" ${COMMON}><path d="M128 176 C94 145 102 105 128 76 C154 105 162 145 128 176Z"/><path d="M117 175 C82 168 63 137 71 107 C101 111 119 139 117 175Z M139 175 C174 168 193 137 185 107 C155 111 137 139 139 175Z"/><path d="M128 224 C91 221 64 203 55 176 C86 171 112 184 128 209 C144 184 170 171 201 176 C192 203 165 221 128 224Z"/></g>` },
  { name:'ginkgo', body:`<g fill="#FFD97A" stroke="#344B68" stroke-width="9" ${COMMON}><path d="M128 178 L78 215 C47 177 57 113 128 80 C199 113 209 177 178 215Z"/><path fill="none" d="M128 178 L128 246 M128 177 L96 117 M128 177 L160 117"/></g>` },
  { name:'maple', body:`<path fill="#FFB454" stroke="#FFB454" stroke-width="9" ${COMMON} d="M128 68 L145 116 L177 91 L171 135 L210 132 L181 163 L203 184 L157 190 L151 229 L128 205 L105 229 L99 190 L53 184 L75 163 L46 132 L85 135 L79 91 L111 116Z M128 202 L128 252"/>` },
  { name:'crane', body:`<g fill="#F5E9C9" stroke="#344B68" stroke-width="10" ${COMMON}><path d="M76 220 C73 180 93 150 126 151 C118 125 125 90 158 75 C146 104 151 128 174 144 L202 151 L176 160 C155 155 145 161 142 177 C139 205 116 225 76 220Z"/><path d="M121 159 C96 117 69 107 55 119 C77 126 91 148 96 177Z"/><path fill="none" d="M104 218 L95 252 M126 211 L132 251 M87 252 L103 252 M124 251 L142 251"/></g>` },
  { name:'koi', body:`<g fill="#FF8D78" stroke="#FF8D78" stroke-width="9" ${COMMON}><path d="M60 160 C89 111 151 105 181 151 L209 116 L203 160 L209 204 L181 169 C151 215 89 209 60 160Z"/><circle fill="#F5E9C9" stroke="none" cx="88" cy="148" r="7"/><path fill="none" d="M128 127 Q145 160 128 193 M154 137 Q169 160 154 183"/></g>` },
  { name:'butterfly', body:`<g fill="#786EA8" stroke="#786EA8" stroke-width="9" ${COMMON}><path d="M120 156 C81 117 53 97 55 142 C57 173 83 183 119 170Z M136 156 C175 117 203 97 201 142 C199 173 173 183 137 170Z M118 176 C84 171 69 198 84 221 C104 231 118 205 122 182Z M138 176 C172 171 187 198 172 221 C152 231 138 205 134 182Z"/><path fill="none" d="M128 141 L128 218 M123 141 Q113 116 98 104 M133 141 Q143 116 158 104"/></g>` },
  { name:'turtle', body:`<g fill="#64DC96" stroke="#64DC96" stroke-width="9" ${COMMON}><path d="M83 111 L151 99 L184 137 L173 196 L111 218 L72 178Z"/><path d="M178 137 L211 126 L201 155Z M86 116 L61 94 L57 124Z M75 174 L49 191 L77 200Z M167 192 L189 218 L158 216Z M111 211 L101 244 L130 218Z"/><path fill="none" stroke="#F5E9C9" d="M105 126 L153 119 L166 151 L151 184 L111 194 L88 164Z"/></g>` },
  { name:'fan', body:`<g fill="none" stroke="#FF8D78" stroke-width="9" ${COMMON}><path fill="#FF8D78" d="M61 181 A82 82 0 0 1 196 119 L157 205Z"/><path stroke="#F5E9C9" d="M157 205 L72 159 M157 205 L91 127 M157 205 L119 105 M157 205 L151 99 M157 205 L179 108"/><path d="M157 205 L178 248"/></g>` },
  { name:'lantern', body:`<g fill="#FFB454" stroke="#FFB454" stroke-width="9" ${COMMON}><path d="M90 109 Q128 82 166 109 L177 196 Q128 220 79 196Z"/><path fill="none" stroke="#F5E9C9" d="M103 116 Q92 160 103 193 M128 106 L128 204 M153 116 Q164 160 153 193"/><path fill="none" d="M94 91 L162 91 M88 212 L168 212 M128 212 L128 252 M113 237 L128 252 L143 237"/></g>` },
  { name:'wind-bell', body:`<g fill="#FFD97A" stroke="#344B68" stroke-width="10" ${COMMON}><path d="M82 183 C84 126 103 94 128 80 C153 94 172 126 174 183 L195 202 L61 202Z"/><path fill="none" d="M128 202 L128 242 M111 242 L145 242 M82 161 L54 147 M174 161 L202 147"/><circle cx="128" cy="218" r="10"/></g>` },
  { name:'parasol', body:`<g fill="none" stroke="#62D6E8" stroke-width="9" ${COMMON}><path fill="#62D6E8" d="M53 149 Q128 68 203 149 Q183 135 166 149 Q147 133 128 149 Q109 133 90 149 Q73 135 53 149Z"/><path stroke="#F5E9C9" d="M128 91 L90 149 M128 91 L166 149"/><path d="M128 148 L128 224 Q128 250 151 237"/></g>` },
  { name:'lucky-knot', body:`<g fill="none" stroke="#FF8D78" stroke-width="10" ${COMMON}><path d="M128 67 L151 91 L175 67 L191 83 L167 107 L191 131 L167 155 L191 179 L175 195 L151 171 L128 195 L105 171 L81 195 L65 179 L89 155 L65 131 L89 107 L65 83 L81 67 L105 91Z"/><path d="M105 91 L151 91 L167 107 L167 155 L151 171 L105 171 L89 155 L89 107Z M128 195 L128 251 M108 225 L128 251 L148 225"/></g>` },
  { name:'coin', body:`<g fill="#FFD97A" stroke="#344B68" stroke-width="10" ${COMMON}><circle fill="none" cx="128" cy="160" r="76"/><path fill="#FFD97A" fill-rule="evenodd" d="M74 106 H182 V214 H74Z M105 137 V183 H151 V137Z"/></g>` },
  { name:'compass-star', body:`<g fill="#62D6E8" stroke="#62D6E8" stroke-width="8" ${COMMON}><path d="M128 58 L143 143 L128 160 L113 143Z M128 262 L113 177 L128 160 L143 177Z M46 160 L111 145 L128 160 L111 175Z M210 160 L145 175 L128 160 L145 145Z"/><path d="M72 104 L116 145 L128 160 L111 151Z M184 216 L140 175 L128 160 L145 169Z M184 104 L145 151 L128 160 L140 145Z M72 216 L111 169 L128 160 L116 175Z"/><circle fill="#F5E9C9" cx="128" cy="160" r="12"/></g>` },
  { name:'vase', body:`<g fill="#786EA8" stroke="#786EA8" stroke-width="9" ${COMMON}><path d="M101 71 H155 L151 104 C149 120 171 127 185 148 C204 177 187 226 164 243 H92 C69 226 52 177 71 148 C85 127 107 120 105 104Z"/><path fill="none" stroke="#F5E9C9" d="M104 101 H152 M89 174 Q128 144 167 174 M96 211 Q128 188 160 211"/><path d="M89 244 H167"/></g>` },
];

/** @param {string} body 문양 본문 @returns {string} 순수 문양 SVG */
function motifDocument(body) { return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="320" viewBox="0 0 256 320">${body}</svg>`; }

/** @param {string} shellData 공용 몸체 데이터 URL @param {string} body 문양 본문 @returns {string} PNG 합성용 SVG */
function compositeDocument(shellData, body) { return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="320" viewBox="0 0 256 320"><image href="${shellData}" width="256" height="320" preserveAspectRatio="none"/>${body}</svg>`; }

/** @param {import('@playwright/test').Page} page 페이지 @param {string} svg SVG @returns {Promise<{hash:string,pixels:number[],bounds:number[]}>} 축소 실루엣 정보 */
async function inspectMotif(page, svg) {
  await page.setContent(`<style>*{margin:0}</style>${svg}`);
  const result = await page.locator('svg').evaluate((node) => {
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=320;const context=canvas.getContext('2d');
    const image=new Image();const source=new XMLSerializer().serializeToString(node);
    return new Promise((resolve)=>{image.onload=()=>{context.drawImage(image,0,0);const data=context.getImageData(0,0,256,320).data;let minX=256,minY=320,maxX=-1,maxY=-1;const pixels=[];for(let y=0;y<320;y+=4)for(let x=0;x<256;x+=4){const alpha=data[(y*256+x)*4+3];pixels.push(alpha>24?1:0);if(alpha>24){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}resolve({pixels,bounds:[minX,minY,maxX,maxY]});};image.src=`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(source)))}`;});
  });
  return { ...result, hash:crypto.createHash('sha256').update(result.pixels.join('')).digest('hex') };
}

/** @param {number[]} a 첫 실루엣 @param {number[]} b 둘째 실루엣 @returns {number} Jaccard 유사도 */
function similarity(a,b){let intersection=0;let union=0;for(let i=0;i<a.length;i+=1){if(a[i]||b[i])union+=1;if(a[i]&&b[i])intersection+=1;}return union?intersection/union:1;}

/** @param {import('@playwright/test').Page} page 페이지 @param {Buffer[]} buffers 타일 PNG @param {number} width 셀 너비 @param {number} height 셀 높이 @param {boolean} grayscale 저채도 여부 @returns {Promise<void>} */
async function createSheet(page,buffers,width,height,grayscale){await page.setViewportSize({width:width*6,height:height*4});const tiles=buffers.map((buffer)=>`<img src="data:image/png;base64,${buffer.toString('base64')}"/>`).join('');await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;display:grid;grid-template-columns:repeat(6,${width}px);background:transparent}img{width:${width}px;height:${height}px;${grayscale?'filter:grayscale(1)':''}}</style>${tiles}`);const suffix=grayscale?'-gray':'';await page.screenshot({path:path.join(TILE_DIR,'source',`tile-contact-sheet-${width}x${height}${suffix}.png`),omitBackground:true});}

/** @returns {Promise<void>} 에셋 전체를 생성하고 AD1 규격을 검증한다. */
async function main() {
  if(MOTIFS.length!==24||new Set(MOTIFS.map((entry)=>entry.name)).size!==24)throw new Error('24개 고유 문양 계약 위반');
  await fs.mkdir(MOTIF_DIR,{recursive:true});const shellData=`data:image/png;base64,${(await fs.readFile(SOURCE)).toString('base64')}`;
  const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:256,height:320},deviceScaleFactor:1});const inspections=[];
  for(let index=0;index<MOTIFS.length;index+=1){const id=String(index+1).padStart(2,'0');const pure=motifDocument(MOTIFS[index].body);if(/<image|data:image/i.test(pure))throw new Error(`${id}: 문양 SVG에 래스터 포함`);const colors=[...pure.matchAll(/#[0-9A-Fa-f]{6}/g)].map((match)=>match[0].toUpperCase());if(colors.some((color)=>!PALETTE.has(color)))throw new Error(`${id}: 팔레트 위반`);const widths=[...pure.matchAll(/stroke-width="([\d.]+)"/g)].map((match)=>Number(match[1]));if(widths.some((width)=>width<8||width>12))throw new Error(`${id}: 선 두께 위반`);await fs.writeFile(path.join(MOTIF_DIR,`motif-${id}.svg`),pure);const inspection=await inspectMotif(page,pure);if(inspection.bounds[0]<36||inspection.bounds[1]<48||inspection.bounds[2]>220||inspection.bounds[3]>272)throw new Error(`${id}: 안전 영역 위반 ${inspection.bounds}`);inspections.push(inspection);const composite=compositeDocument(shellData,MOTIFS[index].body);await page.setContent(`<style>*{margin:0}</style>${composite}`);await page.locator('svg').screenshot({path:path.join(TILE_DIR,`tile-${id}.png`),omitBackground:true});}
  for(let a=0;a<inspections.length;a+=1)for(let b=a+1;b<inspections.length;b+=1){if(inspections[a].hash===inspections[b].hash||similarity(inspections[a].pixels,inspections[b].pixels)>.88)throw new Error(`실루엣 중복: ${a+1}/${b+1}`);}
  const buffers=await Promise.all(Array.from({length:24},(_,index)=>fs.readFile(path.join(TILE_DIR,`tile-${String(index+1).padStart(2,'0')}.png`))));await createSheet(page,buffers,256,320,false);await fs.rename(path.join(TILE_DIR,'source','tile-contact-sheet-256x320.png'),path.join(TILE_DIR,'source','tile-contact-sheet.png'));for(const [width,height] of [[48,60],[56,70],[64,80]]){await createSheet(page,buffers,width,height,false);await createSheet(page,buffers,width,height,true);}
  await page.setViewportSize({width:256,height:320});await page.setContent(`<style>*{margin:0}</style><img width="256" height="320" src="${shellData}">`);await page.locator('img').screenshot({path:path.join(TILE_DIR,'source/tile-shell-256x320.png'),omitBackground:true});await browser.close();
  await fs.writeFile(path.join(TILE_DIR,'source','asset-validation.json'),JSON.stringify({faces:MOTIFS.map((entry,index)=>({faceId:String(index+1).padStart(2,'0'),name:entry.name,bounds:inspections[index].bounds,hash:inspections[index].hash})),safeArea:[36,48,220,272],strokeRange:[8,12],duplicateSilhouettes:0},null,2));
}

await main();
