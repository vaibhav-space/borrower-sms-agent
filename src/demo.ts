import { SMSAgent, CustomerRepository, FakeLLMClient } from './index.js';

async function runDemo(): Promise<void> {
  const repo = new CustomerRepository({ filePath: 'data/customers.json' });

  // ---------------------------------------------------------------------------
  // Case 1: Inbound "STOP" -> Hard opt-out rule, calls markOptOut, sends nothing else
  // ---------------------------------------------------------------------------
  console.log('================================================================');
  console.log('CASE 1: Inbound "STOP" (Borrower Opt-Out)');
  console.log('================================================================');

  const stopAgent = new SMSAgent({
    repository: repo,
    llmClient: new FakeLLMClient()
  });

  const stopResult = await stopAgent.processInboundSMS({
    customerId: 'cust_001',
    message: 'STOP',
    receivedAt: '2026-11-15T14:30:00Z',
    customerTimezone: 'America/New_York'
  });

  console.log('Result:\n', JSON.stringify(stopResult, null, 2));

  // ---------------------------------------------------------------------------
  // Case 2: Inbound Balance Inquiry -> Fake LLM drafts reply & calls getBalance
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('CASE 2: Inbound Balance Inquiry (Model Assisted)');
  console.log('================================================================');

  const inquiryLLM = new FakeLLMClient({
    reply: 'Hello John, your current balance is $0.00.',
    action: 'send',
    reason: 'Customer requested loan balance, retrieved via getBalance tool.',
    toolCallsToExecute: [{ tool: 'getBalance', customerId: 'cust_002' }]
  });

  const balanceAgent = new SMSAgent({
    repository: repo,
    llmClient: inquiryLLM
  });

  const inquiryResult = await balanceAgent.processInboundSMS({
    customerId: 'cust_002',
    message: 'Hi, what is my remaining balance?',
    receivedAt: '2026-11-15T15:00:00Z', // 10:00 AM EST (within 8am-9pm window)
    customerTimezone: 'America/New_York'
  });

  console.log('Result:\n', JSON.stringify(inquiryResult, null, 2));
}

runDemo().catch((err: unknown) => {
  console.error('Demo error:', err);
  process.exit(1);
});
