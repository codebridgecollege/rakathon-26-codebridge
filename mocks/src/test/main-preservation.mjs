// Smoke tests for functions added on main while the visual branch was in progress.
import { createRequire } from 'module';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch();
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
await page.goto(new URL('../../v3.html',import.meta.url).href);
await page.locator('[data-act="newpatient"]').click();
await page.locator('[data-act="fhiropen"]').click();
await page.locator('[data-act="fhirsample"]').click();
await page.locator('[data-act="fhirimport"]').click();
// The sample referral is the intake demo patient's (samples/S02_pacient), read from the page so the test follows the fixture.
const [sample,reason]=await page.evaluate(()=>{const es=SYN.find(x=>x.intake_demo).fhir_referral.entry.map(e=>e.resource);return [es.find(r=>r.resourceType==='Patient').name[0],es.find(r=>r.resourceType==='ServiceRequest').reasonCode[0].text];});
assert.equal(await page.locator('#nf0').inputValue(),sample.given[0]);
assert.equal(await page.locator('#nf1').inputValue(),sample.family);
assert.equal(await page.locator('#nf3').inputValue(),'111');
assert.equal(await page.locator('#nfq').inputValue(),reason);
assert.equal(await page.locator('#nfg').isChecked(),false,'consent still needs a person');
assert.equal(await page.locator('#nf6').getAttribute('autocomplete'),'email');
await page.locator('.modal [data-close]').click();
await page.evaluate(()=>{location.hash='#patient/10/prognosis';});
await page.waitForTimeout(2500);
// Main's saved prognosis replay remains available even without a model service.
await page.waitForSelector('[data-pgpanel]');
await page.locator('[data-pgpanel]').first().click();
assert.equal(await page.locator('.drawer .pgpanel').count(),1);
assert(await page.evaluate(()=>S.overlay.kind==='pgpanel'&&S.access.some(x=>x.what==='otevřel(a) zdroj prognózy')));
await page.locator('.drawer [data-close]').click();
await page.locator('[data-pgref]').first().click();
assert.equal(await page.locator('.drawer .pgrefs li.hit').count(),1);
assert(await page.evaluate(()=>S.overlay.kind==='pgrefs'&&S.overlay.refs.length>0));
await page.locator('.drawer [data-close]').click();
// Verify the same-origin transcript integration without a microphone or a paid model request.
assert(await page.evaluate(async()=>{
 const original=window.fetch; let requested;
 window.fetch=async(url,options)=>{requested={url,options}; return {ok:true,json:async()=>({summary:'Ukázkové shrnutí diskuse'})};};
 try {
  const pid=S.pid;
  S.rec.tx[pid]={lines:[{spk:0,text:['Kontrola MR za tři měsíce.'],wall:Date.now()}],passes:[]};
  await recSummarize(pid);
  return requested.url==='/api/summarize' && requested.options.method==='POST' && JSON.parse(requested.options.body).transcript.includes('Mluvčí 1') && S.rec.tx[pid].summary.state==='done' && S.rec.tx[pid].summary.text==='Ukázkové shrnutí diskuse';
 } finally {window.fetch=original;}
}));
await page.evaluate(()=>{location.hash='#patient/10/overview';});
await page.waitForTimeout(200);
assert.equal(await page.locator('.patient-identity').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(9, 45, 59)');
await page.screenshot({path:path.join(os.tmpdir(),'deploy-overview.png'),fullPage:true});
assert.deepEqual(errors,[]);
console.log('Main preservation: FHIR import, consent/autocomplete, prognosis drawer/replay and transcript summary passed.');
await browser.close();
