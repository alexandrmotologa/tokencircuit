import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

async function renderLogo() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 1024, deviceScaleFactor: 1 });
  const svg = fs.readFileSync('docs/images/logo.svg', 'utf8');
  await page.setContent(`<!DOCTYPE html><html><head><style>body { margin: 0; padding: 0; background: transparent; overflow: hidden; }</style></head><body>${svg}</body></html>`);
  await page.screenshot({ path: 'docs/images/logo.png', omitBackground: true });
  await browser.close();
  console.log('✓ logo.png rendered');
}
renderLogo().catch(console.error);
