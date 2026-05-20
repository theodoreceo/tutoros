import { chromium, devices } from './node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
const iPhone = devices['iPhone 13'];
const context = await browser.newContext({ ...iPhone });
const page = await context.newPage();

await page.goto('http://localhost:3000/');
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/ios_login.png' });

const btn = page.locator('text=Владелец').first();
await btn.click();
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/ios_dashboard.png' });

await page.evaluate(() => window.navigate('students'));
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/ios_crm.png' });

await page.evaluate(() => window.navigate('groups'));
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/ios_groups.png' });

await browser.close();
console.log('done');
