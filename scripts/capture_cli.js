import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function captureCli() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 780, deviceScaleFactor: 2 });

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body {
      margin: 0;
      padding: 40px;
      background: #090d16;
      display: flex;
      justify-content: center;
      align-items: center;
      font-family: 'JetBrains Mono', monospace;
      color: #e2e8f0;
    }
    .window {
      width: 100%;
      max-width: 1060px;
      background: #0b1120;
      border: 1px solid #1e293b;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
    }
    .titlebar {
      background: #0f172a;
      padding: 12px 18px;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid #1e293b;
    }
    .dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }
    .dot-red { background: #ef4444; }
    .dot-yellow { background: #eab308; }
    .dot-green { background: #22c55e; }
    .title {
      font-size: 12px;
      color: #94a3b8;
      margin-left: 12px;
      font-weight: 500;
    }
    .content {
      padding: 24px;
      font-size: 13.5px;
      line-height: 1.65;
    }
    .prompt { color: #38bdf8; }
    .cmd { color: #f8fafc; font-weight: 600; }
    .cyan { color: #38bdf8; font-weight: 700; }
    .green { color: #34d399; font-weight: 600; }
    .yellow { color: #fbbf24; font-weight: 600; }
    .red { color: #f87171; font-weight: 600; }
    .dim { color: #64748b; }
    .bold { font-weight: 700; color: #f1f5f9; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 14px 0;
      font-size: 12.5px;
    }
    th, td {
      padding: 6px 12px;
      text-align: left;
      border: 1px solid #1e293b;
    }
    th {
      background: #0f172a;
      color: #94a3b8;
    }
    .box {
      border-left: 3px solid #34d399;
      padding-left: 12px;
      margin: 10px 0;
    }
  </style>
</head>
<body>
  <div class="window">
    <div class="titlebar">
      <div class="dot dot-red"></div>
      <div class="dot dot-yellow"></div>
      <div class="dot dot-green"></div>
      <span class="title">tokencircuit &mdash; node bin/tokencircuit.js serve --port 50098</span>
    </div>
    <div class="content">
      <div><span class="prompt">$</span> <span class="cmd">tokencircuit serve --config circuit.config.json</span></div>
      <br>
      <div class="cyan">  ⚡ TOKENCIRCUIT GATEWAY CORE</div>
      <div class="dim">  Enterprise LLM Resilience, Cross-Provider Failover & Cost Control</div>
      <br>
      <div>  <span class="green">●</span> Gateway Active:      <span class="bold">http://127.0.0.1:50098</span></div>
      <div>  <span class="green">●</span> OpenAI Ingestion:    <span class="bold">http://127.0.0.1:50098/v1/chat/completions</span></div>
      <div>  <span class="green">●</span> Anthropic Ingestion: <span class="bold">http://127.0.0.1:50098/v1/messages</span></div>
      <div>  <span class="green">●</span> Control Studio:      <span class="bold">http://127.0.0.1:50098/</span></div>
      <div>  <span class="green">●</span> Database Ledger:     <span class="dim">./data/tokencircuit.db (SQLite WAL Mode)</span></div>
      <br>
      <table>
        <tr>
          <th>Provider</th>
          <th>State</th>
          <th>Priority</th>
          <th>Timeout</th>
          <th>Health Status</th>
        </tr>
        <tr>
          <td class="bold">AWS Bedrock</td>
          <td class="green">CLOSED</td>
          <td>1 (Primary)</td>
          <td>10,000ms</td>
          <td>0 consecutive errors &bull; P50 28ms</td>
        </tr>
        <tr>
          <td class="bold">Anthropic Direct</td>
          <td class="green">CLOSED</td>
          <td>2 (Secondary)</td>
          <td>10,000ms</td>
          <td>0 consecutive errors &bull; P50 34ms</td>
        </tr>
        <tr>
          <td class="bold">OpenAI Direct</td>
          <td class="green">CLOSED</td>
          <td>3 (Tertiary)</td>
          <td>12,000ms</td>
          <td>0 consecutive errors &bull; P50 42ms</td>
        </tr>
      </table>
      <div class="dim">  Listening for inbound inference requests. Press Ctrl+C to stop.</div>
      <br>
      <div><span class="prompt">$</span> <span class="cmd">tokencircuit simulate --scenario failover</span></div>
      <br>
      <div class="box">
        <div>1. Primary provider (AWS Bedrock) experiencing consecutive HTTP 503 errors...</div>
        <div>   <span class="red">✗</span> Bedrock attempt 1: 503 Service Unavailable</div>
        <div>   <span class="red">✗</span> Bedrock attempt 2: 503 Service Unavailable</div>
        <div>   <span class="red">✗</span> Bedrock attempt 3: 503 Service Unavailable</div>
        <br>
        <div>2. <span class="yellow">⚡ CIRCUIT TRIPPED</span>: Bedrock state transitioned <span class="green">CLOSED</span> &rarr; <span class="red">OPEN</span>.</div>
        <div>3. Instantaneous Failover Dispatch:</div>
        <div>   <span class="green">✓</span> Request routed to Anthropic Direct (Failover Hop 1) in 48ms.</div>
        <div>   <span class="green">✓</span> Client received seamless 200 OK with zero downtime!</div>
      </div>
    </div>
  </div>
</body>
</html>
  `;

  await page.setContent(html, { waitUntil: 'networkidle0' });
  const outPath = path.resolve(__dirname, '../docs/images/tokencircuit_cli.png');
  await page.screenshot({ path: outPath });
  console.log(`Saved CLI screenshot to ${outPath}`);

  await browser.close();
}

captureCli().catch((err) => {
  console.error('Failed to capture CLI screenshot:', err);
  process.exit(1);
});
