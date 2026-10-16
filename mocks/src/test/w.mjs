import { chromium } from "playwright-core";
import fs from "fs";
const html = fs.readFileSync(process.argv[2], "utf8");
const exe = process.env.CHROME || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(p => fs.existsSync(p));
const b = await chromium.launch({ executablePath: exe });
const pg = await b.newPage({ viewport: { width: 400, height: 800 } });
const errs = []; pg.on("pageerror", e => errs.push(e.message));
await pg.setContent(`<!doctype html><meta name="viewport" content="width=device-width"><body>${html}</body>`);
const check = async n => console.log(n, await pg.evaluate(() => document.documentElement.scrollWidth));
await check("db"); await pg.click('[data-nav="calendar"]'); await check("cal");
await pg.click('[data-open="10_pacient.pdf"]').catch(()=>{}); await pg.click('[data-nav="patients"]'); await pg.click('[data-open="10_pacient.pdf"]'); await check("patient");
for (const t of ["anamnesis","documents","labs","alerts","compare","history"]) { await pg.click(`[data-tab="${t}"]`); await check(t); }
await pg.click('[data-go="present"]'); await check("present"); await pg.click('[data-go="protocol"]'); await check("protocol");
await pg.click('[data-nav="tasks"]'); await check("tasks");
console.log(errs.length ? errs : "no errors"); await b.close();
