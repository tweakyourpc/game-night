// Packaged browser smoke check. Run against tools/dev_server.js --bundle with --words.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.argv[2];
if (!url) throw Error('Pass the URL of a broker-assigned packaged harness with --words.');
const browser = await chromium.launch({executablePath:process.env.CHROME_BIN || '/usr/bin/google-chrome', headless:true, args:['--no-sandbox']});
try {
  const page = await browser.newPage({viewport:{width:1280,height:900}});
  const rpc = async (method, ...args) => (await (await page.request.post(url+'/rpc', {data:{method,args}})).json());
  await page.goto(url);
  const pick = await rpc('join', 'maple owl');
  const ann = pick.members.find(m => m.name === 'Ann');
  const token = (await rpc('join', 'maple owl', {memberId:ann.id,pin:'1234'})).token;
  await page.evaluate(t => GNC.session.set(t), token);
  await page.reload();
  await page.getByRole('button', {name:'Play vs Computer'}).click();
  await page.waitForFunction(() => GNC.app.match && GNC.app.match.players.some(p => p.bot));
  const matchId = await page.evaluate(() => GNC.app.match.id);
  assert.equal(await page.evaluate(() => GNC.app.table.options.game.dictionary), true);
  assert.equal(await page.getByText('Computer', {exact:true}).count() > 0, true);
  for (const width of [1280, 390]) {
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true, width + ' overflow');
    assert.equal(await page.locator('[data-game="wordwright"]').isVisible(), true);
  }
  const before = await rpc('match', token, matchId);
  assert.equal(before.match.rev, 0);
  const pass = await rpc('act', token, matchId, {type:'pass'}, {expectedRevision:0,actionId:crypto.randomUUID().replaceAll('-','')});
  assert.equal(pass.ok, true, pass.error);
  await page.reload();
  await page.waitForFunction(() => GNC.app.match && GNC.app.match.rev >= 2, null, {timeout:15000});
  const after = await rpc('match', token, matchId);
  assert.equal(after.match.rev, 2);
  assert.equal(after.match.view.myRack.length > 0, true);
  assert.equal(JSON.stringify(after.match).includes('"racks"'), false);
  const replay = await rpc('replay', token, matchId);
  assert.deepEqual(replay.replay.events.slice(0,3).map(e => e.type), ['start','pass',replay.replay.events[2].type]);
  assert.equal(replay.replay.events[2].actor, after.match.players[1].id);
  console.log('Packaged computer game: desktop, phone, refresh, turn and replay passed');
} finally { await browser.close(); }
