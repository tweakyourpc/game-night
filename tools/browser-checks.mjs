// Optional developer verification against the actual extracted Apps Script page.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url=process.argv[2];
if (!url) throw Error('Pass the URL of a broker-assigned packaged harness.');
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || '/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const out=path.resolve('build/verification');fs.mkdirSync(out,{recursive:true});
const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
const rpc=async(method,...args)=>{const r=await page.request.post(url+'/rpc',{data:{method,args}});const v=await r.json();assert.equal(v.ok,true,v.error);return v;};
const req=rev=>({expectedRevision:rev,actionId:crypto.randomUUID().replaceAll('-','')});
try {
 await page.goto(url);await page.waitForFunction(()=>window.GNC);
 const pick=await rpc('join','maple owl');const ann=pick.members.find(m=>m.name==='Ann');
 const token=(await rpc('join','maple owl',{memberId:ann.id,pin:'1234'})).token;
 const bob=(await rpc('join','maple owl',{name:'Browser verifier '+Date.now()})).token;
 await page.evaluate(t=>GNC.session.set(t),token);await page.reload();await page.waitForSelector('.gn-catalog');
 for (const id of ['wordwright','fourinarow','dots','checkers','fivefold']) {
  const name=await page.evaluate(id=>GNC.app.lobby.catalog.find(g=>g.id===id).name,id);
  const card=page.locator('.gn-game-card').filter({has:page.getByRole('heading',{name,exact:true})});
  await card.getByRole('button',{name:'How to play'}).click();
  assert.ok((await page.locator('.gn-howto').innerText()).length>400);
  assert.doesNotMatch(await page.locator('.gn-howto').innerText(),/Crabbles|\{game\}/);
  await page.getByRole('button',{name:'Close',exact:true}).click();
  let t=(await rpc('createTable',token,{gameId:id,title:'Verify '+id},req(0).actionId)).table;
  t=(await rpc('sit',bob,t.id,req(t.rev))).table;
  for(const tk of [token,bob]) t=(await rpc('ready',tk,t.id,req(t.rev),true)).table;
  // Open waiting table through the real invitation route, then start through the UI.
  await page.goto(url+'/?t='+t.share_key);await page.waitForFunction(()=>GNC.app.screen==='table'&&GNC.app.table);
  const before=await page.evaluate(()=>JSON.parse(JSON.stringify(GNC.app.table)));
  await page.getByRole('button',{name:'Start game',exact:true}).click();
  await page.waitForSelector('[data-game="'+id+'"]');
  // Deliver a stale pre-start poll after start. It must not roll table or match back.
  await page.evaluate(old=>GNC.poller.onResult({table:{changed:true,table:old}},{table:{id:old.id}}),before);
  assert.equal(await page.evaluate(()=>GNC.app.table.status),'playing');
  assert.equal(await page.evaluate(()=>GNC.app.screen),'table');
  const match=await page.evaluate(()=>GNC.app.match.id);
  for(const theme of ['walnut','slate']) for(const width of [1280,390]) {
   await page.setViewportSize({width,height:900});await page.evaluate(t=>GNC.applyTheme(t),theme);
   await page.screenshot({path:path.join(out,id+'-'+theme+'-'+width+'.png'),fullPage:true});
   assert.ok(await page.locator('[data-game="'+id+'"]').isVisible());
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true,id+' horizontal overflow');
  }
  if(id==='wordwright') {
   await page.setViewportSize({width:390,height:900});
   const labels=()=>page.locator('.ww-rtile').evaluateAll(tiles=>tiles.map(t=>t.getAttribute('aria-label')));
   const beforeRack=await labels();
   await page.getByRole('button',{name:'Arrange tiles'}).click();
   await page.locator('.ww-rtile').first().click();
   await page.locator('.ww-rtile').last().click();
   assert.deepEqual(await labels(),beforeRack.slice(1).concat(beforeRack[0]),'tap sorting changes rack order locally');
   await page.getByRole('button',{name:'Done arranging'}).click();
   const beforeDrag=await labels();
   await page.locator('.ww-rtile').first().dragTo(page.locator('.ww-rtile').last());
   assert.deepEqual(await labels(),beforeDrag.slice(1).concat(beforeDrag[0]),'drag sorting changes rack order locally');
   const active=(await rpc('match',bob,match)).match;
   const resigned=await rpc('act',bob,match,{type:'resign'},req(active.rev));
   assert.equal(resigned.match.status,'finished');
   assert.equal(resigned.match.result.reason,'resignation');
  }
  await page.evaluate(id=>GNC.replay.open(id),match);await page.waitForSelector('.gn-replay');
  await page.getByRole('button',{name:'Last move',exact:true}).click();
  const dl=page.waitForEvent('download');await page.getByRole('button',{name:'Download replay file',exact:true}).click();
  const download=await dl;const dest=path.join(out,id+'-replay.json');await download.saveAs(dest);
  assert.equal(JSON.parse(fs.readFileSync(dest)).game.id,id);
  // Permission failure at recorder construction must remain recoverable.
  const record=page.getByRole('button',{name:'Record video',exact:true});
  await page.waitForTimeout(300);
  if(await record.count()) {
   await page.evaluate(()=>{window.__Recorder=window.MediaRecorder;window.MediaRecorder=function(){throw new DOMException('Denied in test','NotAllowedError');};});
   await record.click();assert.match(await page.locator('.gn-replay [role="status"]').innerText(),/replay file still works/);
   assert.equal(await record.isEnabled(),true);
   await page.evaluate(()=>{window.MediaRecorder=window.__Recorder;});
  }
  await page.locator('.gn-replay').getByRole('button',{name:'Close',exact:true}).click();
  await page.goto(url);await page.waitForSelector('.gn-catalog');
  console.log(id+': instructions, start, stale poll, two themes/two widths, replay download passed');
 }
 // Polls never overlap, and stopped/restarted generations discard old results.
 await page.evaluate(async()=>{
  GNC.poller.stop();while(GNC.poller.inFlight) await new Promise(r=>setTimeout(r,20));
  const call=GNC.call, onResult=GNC.poller.onResult;let resolve, calls=0, results=0;
  GNC.call=()=>{calls++;return new Promise(r=>resolve=r);};GNC.poller.onResult=()=>results++;
  GNC.poller.stopped=false;GNC.poller.tick();GNC.poller.tick();GNC.poller.stop();GNC.poller.start();
  resolve({ok:true});await Promise.resolve();GNC.poller.stop();
  GNC.call=call;GNC.poller.onResult=onResult;
  if(calls!==1||results!==0) throw Error('poll generation or overlap failure');
 });
 assert.deepEqual(errors,[]);
 console.log('Packaged browser checks passed; screenshots in '+out);
} finally {await browser.close();}
