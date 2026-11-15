import { readFile } from 'node:fs/promises';
import {
  SMSAgent,
  CustomerRepository,
  FakeLLMClient,
  RealLLMClient,
  CustomerRecord
} from './index.js';

async function runDemo(): Promise<void> {
  const raw = await readFile('data/customers.json', 'utf-8');
  const customers: CustomerRecord[] = JSON.parse(raw);
  const repo = new CustomerRepository({ initialCustomers: customers });

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
  // Case 2: Inbound Balance Inquiry -> Model drafts reply & calls getBalance
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('CASE 2: Inbound Balance Inquiry (Model Assisted)');
  console.log('================================================================');

  const balanceLLM = new FakeLLMClient({
    reply: 'Hello John, your current balance is $0.00.',
    action: 'send',
    reason: 'Customer requested loan balance, retrieved via getBalance tool.',
    toolCallsToExecute: [{ tool: 'getBalance', customerId: 'cust_002' }]
  });

  const balanceAgent = new SMSAgent({ repository: repo, llmClient: balanceLLM });
  const balanceResult = await balanceAgent.processInboundSMS({
    customerId: 'cust_002',
    message: 'Hi, what is my remaining balance?',
    receivedAt: '2026-11-15T15:00:00Z',
    customerTimezone: 'America/New_York',
    isFirstMessage: true
  });
  console.log('Result:\n', JSON.stringify(balanceResult, null, 2));

  // ---------------------------------------------------------------------------
  // Case 3: Inbound Payment Link Request -> Tool createPaymentLink
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('CASE 3: Inbound Payment Link Request (createPaymentLink)');
  console.log('================================================================');

  const paymentLLM = new FakeLLMClient({
    reply: 'Here is your link to pay $50.00: https://pay.financeops.com/pay/cust_002',
    action: 'send',
    reason: 'Payment link requested and generated.',
    toolCallsToExecute: [
      { tool: 'createPaymentLink', customerId: 'cust_002', amount: 50 }
    ]
  });

  const paymentAgent = new SMSAgent({ repository: repo, llmClient: paymentLLM });
  const paymentResult = await paymentAgent.processInboundSMS({
    customerId: 'cust_002',
    message: 'Can I get a link to pay $50?',
    receivedAt: '2026-11-15T15:00:00Z',
    customerTimezone: 'America/New_York',
    isFirstMessage: false
  });
  console.log('Result:\n', JSON.stringify(paymentResult, null, 2));

  // ---------------------------------------------------------------------------
  // Case 4: Inbound Dispute -> In-Code Rule routes to human handoff
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('CASE 4: Inbound Borrower Dispute (In-Code Rule: Handoff)');
  console.log('================================================================');

  const disputeAgent = new SMSAgent({
    repository: repo,
    llmClient: new FakeLLMClient()
  });
  const disputeResult = await disputeAgent.processInboundSMS({
    customerId: 'cust_001',
    message: 'I dispute this debt. I already paid this in full last week.',
    receivedAt: '2026-11-15T15:00:00Z',
    customerTimezone: 'America/New_York'
  });
  console.log('Result:\n', JSON.stringify(disputeResult, null, 2));

  // ---------------------------------------------------------------------------
  // Case 5 (Optional): Live Real Model Run if API key is present
  // ---------------------------------------------------------------------------
  const hasApiKey = Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
  if (hasApiKey) {
    console.log('\n================================================================');
    console.log('CASE 5: Real Model Live Execution (ILLMClient)');
    console.log('================================================================');
    try {
      const realAgent = new SMSAgent({
        repository: repo,
        llmClient: new RealLLMClient()
      });
      const realResult = await realAgent.processInboundSMS({
        customerId: 'cust_002',
        message: 'Hi, can you tell me my balance and send a payment link for $25?',
        receivedAt: '2026-11-15T15:00:00Z',
        customerTimezone: 'America/New_York',
        isFirstMessage: false
      });
      console.log('Result from Real LLM:\n', JSON.stringify(realResult, null, 2));
    } catch (err: unknown) {
      console.error('Real model run failed:', err);
    }
  }
}

runDemo().catch((err: unknown) => {
  console.error('Demo error:', err);
  process.exit(1);
});
