const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1000, height: 600 } });
  const errs = []; const reqs = [];
  p.on('console', m => { if (['error', 'warning'].includes(m.type())) errs.push(m.text()); });
  p.on('pageerror', e => errs.push(e.message));
  p.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) reqs.push(r.url()); });
  await p.goto('file:///workspace/pelican-ride/pelican-ride.html'); await p.waitForTimeout(800);
  await p.click('#start'); await p.keyboard.down('ArrowUp'); await p.waitForTimeout(1500); await p.keyboard.up('ArrowUp');
  await p.click('#routeBtn'); await p.waitForTimeout(300); await p.click('#routeGrid [data-route="field"]'); await p.waitForTimeout(1500);
  await p.click('#home'); await p.waitForTimeout(300);
  console.log(JSON.stringify(await p.evaluate(() => window.__pelican.stats)));
  console.log('errors:', errs.length ? errs : 'none', 'external requests:', reqs.length ? reqs : 'none');
  await b.close();
})();
