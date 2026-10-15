import puppeteer from 'puppeteer';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TokenCircuitGateway } from '../dist/index.js';
import { MockSandboxProvider } from '../dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function capture() {
  console.log('1. Starting TokenCircuit Gateway on http://localhost:50098...');
  const gateway = new TokenCircuitGateway({
    port: 50098,
    dbPath: ':memory:'
  });

  // Register dedicated demo provider so live requests in Playground & GIF stream cleanly
  const demoProvider = new MockSandboxProvider('demo-resilience', 'TokenCircuit Resilience Engine');
  gateway.failoverChain.registerProvider(demoProvider, 1);
  gateway.failoverChain.setPriorityOrder(['demo-resilience', 'bedrock', 'anthropic', 'openai']);

  await gateway.start(50098);
  console.log('✓ Gateway running on http://127.0.0.1:50098');

  // Seed realistic demonstration data
  console.log('2. Seeding enterprise resilience & budget demonstration data...');
  gateway.ledger.setTenantBudget('production-agents', {
    name: 'Production AI Swarm',
    dailyLimitUsd: 100.0,
    monthlyLimitUsd: 1000.0,
    autoDowngradeEnabled: true
  });

  gateway.ledger.setTenantBudget('data-engineering', {
    name: 'Data Pipeline ETL',
    dailyLimitUsd: 50.0,
    monthlyLimitUsd: 500.0,
    autoDowngradeEnabled: true
  });

  gateway.ledger.setTenantBudget('autonomous-researcher', {
    name: 'Autonomous Research Loop',
    dailyLimitUsd: 25.0,
    monthlyLimitUsd: 250.0,
    autoDowngradeEnabled: true
  });

  // Seed transactions
  const now = Date.now();
  gateway.ledger.recordTransaction({
    id: 'tx_01',
    tenantId: 'production-agents',
    clientProtocol: 'anthropic',
    requestedModel: 'claude-3-5-sonnet-20241022',
    dispatchedModel: 'claude-3-5-sonnet-20241022',
    downgraded: false,
    primaryProvider: 'bedrock',
    resolvedProvider: 'anthropic',
    failoverOccurred: true,
    failoverHops: [
      { providerId: 'bedrock', model: 'claude-3-5-sonnet-20241022', timestamp: now - 12000, statusCode: 503, errorMessage: 'Bedrock 503 Service Unavailable', latencyMs: 14 }
    ],
    inputTokens: 2450,
    outputTokens: 780,
    cachedTokens: 1200,
    costUsd: 0.01905,
    latencyMs: 76,
    timestamp: now - 11000,
    statusCode: 200
  });

  gateway.ledger.recordTransaction({
    id: 'tx_02',
    tenantId: 'data-engineering',
    clientProtocol: 'openai',
    requestedModel: 'claude-3-5-sonnet-20241022',
    dispatchedModel: 'claude-3-5-haiku-20241022',
    downgraded: true,
    primaryProvider: 'anthropic',
    resolvedProvider: 'anthropic',
    failoverOccurred: false,
    failoverHops: [],
    inputTokens: 3800,
    outputTokens: 420,
    cachedTokens: 0,
    costUsd: 0.00472,
    latencyMs: 38,
    timestamp: now - 8000,
    statusCode: 200
  });

  gateway.ledger.recordTransaction({
    id: 'tx_03',
    tenantId: 'production-agents',
    clientProtocol: 'openai',
    requestedModel: 'gpt-4o',
    dispatchedModel: 'gpt-4o',
    downgraded: false,
    primaryProvider: 'anthropic',
    resolvedProvider: 'openai',
    failoverOccurred: true,
    failoverHops: [
      { providerId: 'anthropic', model: 'gpt-4o', timestamp: now - 5000, statusCode: 429, errorMessage: 'Rate limit exceeded (429)', latencyMs: 8 }
    ],
    inputTokens: 1850,
    outputTokens: 520,
    cachedTokens: 0,
    costUsd: 0.009825,
    latencyMs: 62,
    timestamp: now - 4000,
    statusCode: 200
  });

  gateway.ledger.recordTransaction({
    id: 'tx_04',
    tenantId: 'autonomous-researcher',
    clientProtocol: 'openai',
    requestedModel: 'gpt-4o',
    dispatchedModel: 'gpt-4o',
    downgraded: false,
    primaryProvider: 'openai',
    resolvedProvider: 'openai',
    failoverOccurred: false,
    failoverHops: [],
    inputTokens: 1200,
    outputTokens: 280,
    cachedTokens: 0,
    costUsd: 0.0058,
    latencyMs: 29,
    timestamp: now - 2000,
    statusCode: 200
  });

  // Seed spend to demonstrate status states
  gateway.ledger.recordTransaction({
    id: 'tx_seed_de',
    tenantId: 'data-engineering',
    clientProtocol: 'openai',
    requestedModel: 'claude-3-5-sonnet',
    dispatchedModel: 'claude-3-5-sonnet',
    downgraded: false,
    primaryProvider: 'anthropic',
    resolvedProvider: 'anthropic',
    failoverOccurred: false,
    failoverHops: [],
    inputTokens: 10000,
    outputTokens: 5000,
    cachedTokens: 0,
    costUsd: 42.50,
    latencyMs: 120,
    timestamp: now - 100000,
    statusCode: 200
  });

  gateway.ledger.recordTransaction({
    id: 'tx_seed_ar',
    tenantId: 'autonomous-researcher',
    clientProtocol: 'openai',
    requestedModel: 'gpt-4o',
    dispatchedModel: 'gpt-4o',
    downgraded: false,
    primaryProvider: 'openai',
    resolvedProvider: 'openai',
    failoverOccurred: false,
    failoverHops: [],
    inputTokens: 15000,
    outputTokens: 8000,
    cachedTokens: 0,
    costUsd: 25.00,
    latencyMs: 140,
    timestamp: now - 100000,
    statusCode: 200
  });

  // Seed circuit state: Bedrock is OPEN (simulated incident)
  gateway.circuitBreaker.forceTrip('bedrock', 'Upstream AWS Bedrock 503 incident');

  // Seed loop detection
  gateway.ledger.recordLoopDetection('autonomous-researcher', 'search_codebase', 'sha256_e81b...', 4, 18.50);

  // Seed Prompt Cache (Zero-Cost Hits)
  gateway.promptCache.set(
    'gpt-4o',
    [{ role: 'user', content: 'What is TokenCircuit?' }],
    { id: 'chatcmpl_c1', model: 'gpt-4o', choices: [{ message: { role: 'assistant', content: 'TokenCircuit is an enterprise LLM circuit breaker and budget gateway.' } }], usage: { promptTokens: 320, completionTokens: 140, totalTokens: 460 } },
    0.0035
  );
  gateway.promptCache.set(
    'claude-3-5-sonnet-20241022',
    [{ role: 'user', content: 'Summarize system logs' }],
    { id: 'msg_c2', model: 'claude-3-5-sonnet-20241022', content: [{ type: 'text', text: 'All circuits nominal.' }], usage: { input_tokens: 850, output_tokens: 210 } },
    0.0057
  );
  // Record cache hits to demonstrate hit ratio and savings
  gateway.promptCache.get('gpt-4o', [{ role: 'user', content: 'What is TokenCircuit?' }]);
  gateway.promptCache.get('gpt-4o', [{ role: 'user', content: 'What is TokenCircuit?' }]);
  gateway.promptCache.get('gpt-4o', [{ role: 'user', content: 'What is TokenCircuit?' }]);

  // Seed Rate Limiter usage
  gateway.rateLimiter.setTenantLimits('production-agents', { maxRpm: 120, maxTpm: 250000 });
  gateway.rateLimiter.setTenantLimits('data-engineering', { maxRpm: 60, maxTpm: 100000 });
  gateway.rateLimiter.setTenantLimits('autonomous-researcher', { maxRpm: 30, maxTpm: 50000 });
  gateway.rateLimiter.recordUsage('production-agents', 45000);
  gateway.rateLimiter.recordUsage('production-agents', 32000);
  gateway.rateLimiter.recordUsage('data-engineering', 68000);
  gateway.rateLimiter.recordUsage('autonomous-researcher', 12000);

  // Seed Webhook Dispatcher
  gateway.webhookDispatcher.setWebhookUrl('https://hooks.slack.com/services/T000/B000/XXXXX');
  gateway.webhookDispatcher.dispatch({
    eventType: 'circuit_tripped',
    title: 'Provider Trip: AWS Bedrock',
    summary: 'Bedrock failed 3 consecutive times with 503. State set to OPEN.',
    severity: 'WARNING',
    metadata: { providerId: 'bedrock', reason: 'Upstream AWS Bedrock 503 incident' }
  });

  const outDir = path.resolve(__dirname, '../docs/images');
  const tempFramesDir = path.resolve(__dirname, '../temp_frames');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  if (fs.existsSync(tempFramesDir)) fs.rmSync(tempFramesDir, { recursive: true, force: true });
  fs.mkdirSync(tempFramesDir, { recursive: true });

  console.log('3. Launching headless browser for high-res captures...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // 1. Desktop Dashboard (1440x960)
  console.log('Capturing docs/images/tokencircuit_dashboard.png (Desktop)...');
  await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 2 });
  await page.goto('http://localhost:50098', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: path.join(outDir, 'tokencircuit_dashboard.png') });

  // 2. Tablet View (768x1024 - iPad)
  console.log('Capturing docs/images/tokencircuit_tablet.png (Tablet)...');
  await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 2 });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(outDir, 'tokencircuit_tablet.png') });

  // 3. Mobile View (390x844 - iPhone)
  console.log('Capturing docs/images/tokencircuit_mobile.png (Mobile)...');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(outDir, 'tokencircuit_mobile.png') });

  // Reset back to Desktop for feature closeups
  await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 2 });
  await new Promise((r) => setTimeout(r, 400));

  // 4. Circuit Status Grid
  console.log('Capturing docs/images/tokencircuit_circuit_grid.png...');
  const circuitElement = await page.$('div.grid.grid-cols-1.md\\:grid-cols-3');
  if (circuitElement) {
    await circuitElement.screenshot({ path: path.join(outDir, 'tokencircuit_circuit_grid.png') });
  }

  // 5. Budget Meters
  console.log('Capturing docs/images/tokencircuit_budget_meters.png...');
  const budgetElement = await page.$('div.grid.grid-cols-1.md\\:grid-cols-2');
  if (budgetElement) {
    await budgetElement.screenshot({ path: path.join(outDir, 'tokencircuit_budget_meters.png') });
  }

  // 6. Failover Stream
  console.log('Capturing docs/images/tokencircuit_failover_stream.png...');
  const streamElement = await page.$('div.rounded-xl.border.border-slate-800.bg-\\[\\#111622\\]\\/90');
  if (streamElement) {
    await streamElement.screenshot({ path: path.join(outDir, 'tokencircuit_failover_stream.png') });
  }

  // 7. Chaos Lab
  console.log('Capturing docs/images/tokencircuit_chaos_lab.png...');
  const chaosElement = await page.$('div.grid.grid-cols-1.sm\\:grid-cols-2.lg\\:grid-cols-4');
  if (chaosElement) {
    await chaosElement.screenshot({ path: path.join(outDir, 'tokencircuit_chaos_lab.png') });
  }

  // 8. Interactive Demo Recording for GIF
  console.log('Recording interactive frames for tokencircuit_demo.gif...');
  
  // Capture initial state
  for (let i = 0; i < 8; i++) {
    await page.screenshot({ path: path.join(tempFramesDir, `frame_${String(i).padStart(3, '0')}.png`) });
    await new Promise((r) => setTimeout(r, 120));
  }

  // Click "Send Live Request" in Playground
  console.log('Triggering live inference test in playground...');
  const buttons = await page.$$('button');
  for (const b of buttons) {
    const text = await page.evaluate((el) => el.textContent, b);
    if (text && text.includes('Send Live Request')) {
      await b.click();
      break;
    }
  }

  for (let i = 8; i < 22; i++) {
    await page.screenshot({ path: path.join(tempFramesDir, `frame_${String(i).padStart(3, '0')}.png`) });
    await new Promise((r) => setTimeout(r, 120));
  }

  // Click "Trip Bedrock Outage"
  for (const b of buttons) {
    const text = await page.evaluate((el) => el.textContent, b);
    if (text && text.includes('Trip Bedrock Outage')) {
      await b.click();
      break;
    }
  }

  for (let i = 22; i < 36; i++) {
    await page.screenshot({ path: path.join(tempFramesDir, `frame_${String(i).padStart(3, '0')}.png`) });
    await new Promise((r) => setTimeout(r, 120));
  }

  await browser.close();
  await gateway.stop();

  // 9. Assemble animated GIF with FFmpeg
  console.log('Compiling docs/images/tokencircuit_demo.gif via FFmpeg...');
  const gifPath = path.join(outDir, 'tokencircuit_demo.gif');
  const ffmpegCmd = `ffmpeg -y -framerate 8 -i "${path.join(tempFramesDir, 'frame_%03d.png')}" -vf "fps=8,scale=1080:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" "${gifPath}"`;

  try {
    execSync(ffmpegCmd, { stdio: 'inherit' });
    console.log(`✓ Animated demo GIF successfully generated: ${gifPath}`);
  } catch (err) {
    console.error('FFmpeg GIF generation failed:', err);
  }

  fs.rmSync(tempFramesDir, { recursive: true, force: true });
  console.log('All visual assets captured successfully.');
}

capture().catch((err) => {
  console.error('Fatal capture error:', err);
  process.exit(1);
});
