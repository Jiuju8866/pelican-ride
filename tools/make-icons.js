// Renders the app icons (icon-192.png, icon-512.png) from the in-game pelican drawing.
// usage: node make-icons.js [repoDir]   (needs playwright-core + Chrome, like the other tools)
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const repo = process.argv[2] || '/workspace/pelican-ride';
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto('file://' + path.join(repo, 'pelican-ride.html'));
  await page.waitForFunction(() => window.__pelican);
  for (const size of [192, 512]) {
    const url = await page.evaluate(s => window.__pelican.debug.iconDataURL(s), size);
    const out = path.join(repo, `icon-${size}.png`);
    fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote', out, fs.statSync(out).size, 'bytes');
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
