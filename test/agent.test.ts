import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CustomerRepository } from '../src/repository.js';
import { FakeLLMClient } from '../src/llm/fake.js';
import { SMSAgent } from '../src/agent.js';
import { AgentOutputSchema } from '../src/schemas.js';
import { CustomerRecord } from '../src/types.js';

const INITIAL_CUSTOMERS: CustomerRecord[] = [
  {
    id: 'cust_001',
    name: 'Sarah Connor',
    phone: '+15551234567',
    balance: 1450.00,
    currency: 'USD',
    isOptedOut: false
  },
  {
    id: 'cust_002',
    name: 'John Doe',
    phone: '+15552345678',
    balance: 0.00,
    currency: 'USD',
    isOptedOut: false
  },
  {
    id: 'cust_003',
    name: 'Alex Mercer',
    phone: '+15553456789',
    balance: 8320.50,
    currency: 'USD',
    isOptedOut: true
  }
];

describe('SMSAgent Test Suite', () => {
  let repository: CustomerRepository;
  let fakeLLM: FakeLLMClient;
  let agent: SMSAgent;

  beforeEach(() => {
    // Isolated in-memory customer repository for each test
    repository = new CustomerRepository({
      initialCustomers: INITIAL_CUSTOMERS
    });
    fakeLLM = new FakeLLMClient();
    agent = new SMSAgent({
      repository,
      llmClient: fakeLLM
    });
  });

  it('On "STOP", calls markOptOut and sends nothing else', async () => {
    const beforeCust = await repository.getCustomer('cust_001');
    assert.strictEqual(beforeCust?.isOptedOut, false);

    const input = {
      customerId: 'cust_001',
      message: 'STOP',
      receivedAt: '2026-11-15T14:30:00Z',
      customerTimezone: 'America/New_York'
    };

    const output = await agent.processInboundSMS(input);
    AgentOutputSchema.parse(output);

    assert.strictEqual(output.reply, '');
    assert.strictEqual(output.action, 'hold');
    assert.strictEqual(output.toolCalls.length, 1);
    assert.strictEqual(output.toolCalls[0]?.tool, 'markOptOut');
    assert.deepStrictEqual(output.toolCalls[0]?.input, { customerId: 'cust_001' });

    const afterCust = await repository.getCustomer('cust_001');
    assert.strictEqual(afterCust?.isOptedOut, true);
    assert.strictEqual(fakeLLM.invocations.length, 0);
  });

  it('Generates payment link via createPaymentLink tool', async () => {
    fakeLLM.setResponse({
      reply: 'Here is your secure link to pay $100.00: https://pay.financeops.com/pay/cust_001',
      action: 'send',
      reason: 'Payment link requested and provided',
      toolCallsToExecute: [
        { tool: 'createPaymentLink', customerId: 'cust_001', amount: 100 }
      ]
    });

    const input = {
      customerId: 'cust_001',
      message: 'Can I get a link to pay $100?',
      receivedAt: '2026-11-15T15:00:00Z',
      customerTimezone: 'America/New_York'
    };

    const output = await agent.processInboundSMS(input);
    AgentOutputSchema.parse(output);

    assert.strictEqual(output.action, 'send');
    assert.strictEqual(output.toolCalls.length, 1);
    assert.strictEqual(output.toolCalls[0]?.tool, 'createPaymentLink');
    assert.strictEqual(output.toolCalls[0]?.input.amount, 100);

    const toolResult = output.toolCalls[0]?.output;
    assert.ok(toolResult && 'paymentLink' in toolResult);
    assert.match(toolResult.paymentLink, /https:\/\/pay\.financeops\.com\/pay\/cust_001/);
    assert.strictEqual(toolResult.amount, 100);
  });

  it('Blocks cross-customer tool execution and routes to handoff', async () => {
    // Borrower cust_001 attempts to call getBalance for cust_003
    fakeLLM.setResponse({
      reply: 'The balance for cust_003 is $8,320.50',
      action: 'send',
      reason: 'Attempted cross-customer query',
      toolCallsToExecute: [{ tool: 'getBalance', customerId: 'cust_003' }]
    });

    const input = {
      customerId: 'cust_001',
      message: 'Check balance for cust_003',
      receivedAt: '2026-11-15T15:00:00Z',
      customerTimezone: 'America/New_York'
    };

    const output = await agent.processInboundSMS(input);
    AgentOutputSchema.parse(output);

    assert.strictEqual(output.action, 'handoff');
    assert.match(output.reason, /Cross-customer security violation/i);
  });

  it('Catches post-LLM cross-customer data leakage in reply and strips it', async () => {
    // Model drafts reply leaking John Doe's information to Sarah Connor
    fakeLLM.setResponse({
      reply: 'Hello Sarah, your neighbor John Doe owes $8,320.50 on his loan.',
      action: 'send',
      reason: 'Answered inquiry'
    });

    const input = {
      customerId: 'cust_001',
      message: 'Who else has a loan?',
      receivedAt: '2026-11-15T15:00:00Z',
      customerTimezone: 'America/New_York'
    };

    const output = await agent.processInboundSMS(input);
    AgentOutputSchema.parse(output);

    // Guardrail must clear the leaking reply and set handoff
    assert.strictEqual(output.reply, '');
    assert.strictEqual(output.action, 'handoff');
    assert.match(output.reason, /Privacy violation detected/i);
  });

  it('Directly routes borrower disputes to human handoff', async () => {
    const input = {
      customerId: 'cust_001',
      message: 'I dispute this debt. I already paid this in full last week.',
      receivedAt: '2026-11-15T15:00:00Z',
      customerTimezone: 'America/New_York'
    };

    const output = await agent.processInboundSMS(input);
    AgentOutputSchema.parse(output);

    assert.strictEqual(output.action, 'handoff');
    assert.match(output.reply, /specialist who will review your account/i);
    assert.match(output.reason, /dispute.*payment claim/i);
    assert.strictEqual(fakeLLM.invocations.length, 0); // Deterministic, no LLM cost
  });

  it('Does NOT falsely trigger dispute on "no dispute"', async () => {
    fakeLLM.setResponse({
      reply: 'Thanks for reaching out, how can we help?',
      action: 'send',
      reason: 'Answered'
    });

    const input = {
      customerId: 'cust_001',
      message: 'I have no dispute, just wanted to check my due date.',
      receivedAt: '2026-11-15T15:00:00Z',
      customerTimezone: 'America/New_York'
    };

    const output = await agent.processInboundSMS(input);
    AgentOutputSchema.parse(output);

    assert.strictEqual(output.action, 'send');
    assert.strictEqual(fakeLLM.invocations.length, 1);
  });

  it('Suppresses amount owed in first reply if borrower did not ask for it', async () => {
    fakeLLM.setResponse({
      reply: 'Your current balance is $1,450.00 and is overdue.',
      action: 'send',
      reason: 'Reminder sent'
    });

    // First contact, borrower did NOT ask for balance
    const input = {
      customerId: 'cust_001',
      message: 'Hi, I received a message from you.',
      receivedAt: '2026-11-15T15:00:00Z',
      customerTimezone: 'America/New_York',
      isFirstMessage: true
    };

    const output = await agent.processInboundSMS(input);
    AgentOutputSchema.parse(output);

    // Must NOT contain monetary figure
    assert.doesNotMatch(output.reply, /\$1,450\.00/);
    assert.match(output.reply, /How can we assist you with your account today/i);
    assert.match(output.reason, /Amount owed omitted from first reply/i);
  });

  it('Permits amount owed in first reply if borrower explicitly asks for it', async () => {
    fakeLLM.setResponse({
      reply: 'Hi Sarah, your current balance is $1,450.00.',
      action: 'send',
      reason: 'Balance inquiry fulfilled',
      toolCallsToExecute: [{ tool: 'getBalance', customerId: 'cust_001' }]
    });

    const input = {
      customerId: 'cust_001',
      message: 'How much do I owe right now?',
      receivedAt: '2026-11-15T15:00:00Z',
      customerTimezone: 'America/New_York',
      isFirstMessage: true
    };

    const output = await agent.processInboundSMS(input);
    AgentOutputSchema.parse(output);

    assert.strictEqual(output.action, 'send');
    assert.match(output.reply, /\$1,450\.00/);
    assert.strictEqual(output.toolCalls[0]?.tool, 'getBalance');
  });

  it('Overrides action to "hold" during quiet hours outside 8am-9pm', async () => {
    fakeLLM.setResponse({
      reply: 'Your balance is $1,450.00.',
      action: 'send',
      reason: 'Balance inquiry answered'
    });

    // 03:30 AM local time in New York
    const input = {
      customerId: 'cust_001',
      message: 'What is my balance?',
      receivedAt: '2026-11-15T08:30:00Z',
      customerTimezone: 'America/New_York'
    };

    const output = await agent.processInboundSMS(input);
    AgentOutputSchema.parse(output);

    assert.strictEqual(output.action, 'hold');
    assert.match(output.reason, /outside permissible 8am-9pm window/i);
  });
});
