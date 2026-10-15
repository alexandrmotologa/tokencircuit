/**
 * TokenCircuit Agent Loop & Failover Test Harness
 * Demonstrates how repetitive agent tool calls trigger immediate gateway circuit breaking.
 */

async function runLoopTest() {
  const GATEWAY_URL = 'http://localhost:50098/v1/chat/completions';
  const TENANT_ID = 'agent-testing-cluster';

  console.log('Sending repetitive tool calls to TokenCircuit gateway...');

  const toolCallPayload = {
    model: 'gpt-4o',
    messages: [
      { role: 'user', content: 'Fetch deployment status for pipeline #4092' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_99182',
            type: 'function',
            function: {
              name: 'query_ci_pipeline',
              arguments: JSON.stringify({ pipeline_id: 4092, check_cached: true })
            }
          }
        ]
      }
    ]
  };

  for (let attempt = 1; attempt <= 4; attempt++) {
    console.log(`\n--- Attempt ${attempt} ---`);
    try {
      const response = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': TENANT_ID
        },
        body: JSON.stringify(toolCallPayload)
      });

      console.log(`Status Code: ${response.status} ${response.statusText}`);
      console.log(`Provider:    ${response.headers.get('x-tokencircuit-provider')}`);
      console.log(`Cost:        $${response.headers.get('x-tokencircuit-cost-usd')}`);

      const data = await response.json();
      if (!response.ok) {
        console.log('Loop Intercepted by TokenCircuit:');
        console.log(JSON.stringify(data, null, 2));
        break;
      } else {
        console.log('Response succeeded.');
      }
    } catch (err: any) {
      console.error(`Request failed: ${err.message}`);
    }
  }
}

runLoopTest();
