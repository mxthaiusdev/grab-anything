// Collections test: GrabBoards CRUD + persistence + ZIP export on the board
// page (where GrabBoards is a normal global), plus a real picker→board flow.
import { createServer } from 'http';
import { mkdtempSync, statSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const server = createServer((q,s)=>{ if(q.url==='/i.png'){s.setHeader('content-type','image/png');s.end(PNG);return;} s.setHeader('content-type','text/html'); s.end('<img id="pic" src="/i.png" width="80" height="60">'); });
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const BASE=`http://127.0.0.1:${server.address().port}/`;

const results=[]; const check=(n,c,d='')=>results.push({n,ok:!!c,d});
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(),'ga-col-')),{
  channel:'chromium', args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`] });
let sw=ctx.serviceWorkers()[0]; if(!sw) sw=await ctx.waitForEvent('serviceworker',{timeout:15000});
const extId = new URL(sw.url()).host;
const dls=[]; const track=(p)=>p.on('download', async d=>dls.push({name:d.suggestedFilename(), path:await d.path()}));

// ---- CRUD + export on the board page (GrabBoards is a page global there) ----
const bp = await ctx.newPage(); track(bp);
await bp.goto('chrome-extension://'+extId+'/collections.html');
await bp.waitForTimeout(700);
const crud = await bp.evaluate(async (base) => {
  const b = await GrabBoards.create('Test Board');
  await GrabBoards.addItem(b.id, { type:'image', url: base+'i.png', thumb: base+'i.png', meta:{name:'i.png'} });
  await GrabBoards.addItem(b.id, { type:'color', content:'#5757F7' });
  await GrabBoards.addItem(b.id, { type:'svg', content:'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="window.__pwned=1"><script>window.__pwned=1<\/script><rect width="10" height="10" fill="red"/></svg>', meta:{name:'sq'} });
  const dup = await GrabBoards.addItem(b.id, { type:'color', content:'#5757F7' });
  const full = await GrabBoards.get(b.id);
  return { id:b.id, count: full.items.length, dup: !!(dup&&dup.duplicate), name: full.name };
}, BASE);
check('board create', crud.name==='Test Board');
check('addItem stores 3 distinct items', crud.count===3, 'count='+crud.count);
check('duplicate color de-duped', crud.dup);

await bp.reload(); await bp.waitForTimeout(700);
const persisted = await bp.evaluate(async (id)=>{ const b=await GrabBoards.get(id); return b?b.items.length:-1; }, crud.id);
check('items persist across reload', persisted===3, 'persisted='+persisted);

const cards = await bp.evaluate(()=>document.querySelectorAll('#grid .card').length);
check('board page renders item cards', cards>=3, 'cards='+cards);
await bp.click('#exportBtn');
let zip=null; for(let i=0;i<40&&!zip;i++){ zip=dls.find(d=>d.name.endsWith('.zip')); if(!zip) await new Promise(r=>setTimeout(r,300)); }
if (zip){
  const listing = execSync('unzip -l '+zip.path, {encoding:'utf8'});
  check('board exports a valid ZIP', statSync(zip.path).size>200);
  check('ZIP has moodboard + colors + image', listing.includes('moodboard.html') && listing.includes('colors.css') && /images\//.test(listing),
    listing.split('\n').filter(l=>/\.(html|css|png|svg|md)/.test(l)).map(l=>l.trim().split(/\s+/).pop()).join(' '));
  const { mkdtempSync:mkd } = await import('fs'); const { tmpdir:td } = await import('os');
  const out = mkd(path.join(td(),'ga-unz-')); execSync('unzip -o '+zip.path+' -d '+out);
  const mood = readFileSync(path.join(out,'moodboard.html'),'utf8');
  check('moodboard.html does NOT inline SVG script (XSS-safe)', !mood.includes('__pwned') && !/onload=/.test(mood), mood.slice(0,240));
  check('moodboard references svg as <img>', /<img src="svg\//.test(mood));
} else { check('board exports a valid ZIP', false, 'no zip'); check('ZIP has moodboard + colors + image', false); }

// ---- real picker → ＋Board flow from a content page ----
const page = await ctx.newPage(); track(page);
await page.goto(BASE); await page.waitForTimeout(900);
const tabId = await sw.evaluate(async b=>(await chrome.tabs.query({})).find(t=>(t.url||'').startsWith(b)).id, BASE);
await sw.evaluate(id=>chrome.tabs.sendMessage(id,{type:'ga-picker-start'},{frameId:0}), tabId);
await page.waitForTimeout(250);
const pb = await page.locator('#pic').boundingBox();
await page.mouse.move(pb.x+40, pb.y+30); await page.waitForTimeout(250);
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(300);
const hasBoardBtn = await page.evaluate(()=>!!document.querySelector('[data-ga-action="add-board"]'));
check('picker shows ＋Board button', hasBoardBtn);
if (hasBoardBtn){
  await page.click('[data-ga-action="add-board"]'); await page.waitForTimeout(600);
  const added = await bp.evaluate(async ()=>{ const l=await GrabBoards.list(); const b=await GrabBoards.get(l.activeId); return b?b.items.some(i=>i.type==='image'&&/i\.png/.test(i.url||'')):false; });
  check('picker ＋Board adds the image to active board', added);
}

console.log('\n=== collections test ===');
let fail=0; for(const r of results){ console.log((r.ok?'  PASS':'✗ FAIL')+'  '+r.n+(r.ok?'':'   '+r.d)); if(!r.ok)fail++; }
console.log(fail?('\n'+fail+' FAILURES'):'\nall green');
await ctx.close(); server.close(); process.exit(fail?1:0);
