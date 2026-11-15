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
    // Customer starts not opted-out
    const beforeCust = await repository.getCustomer('cust_001');
    assert.strictEqual(beforeCust?.isOptedOut, false);

    const input = {
      customerId: 'cust_001',
      message: 'STOP',
      receivedAt: '2026-11-15T14:30:00Z',
      customerTimezone: 'America/New_York'
    };

    const output = await agent.processInboundSMS(input);

    // Validate structured output against schema
    const validated = AgentOutputSchema.parse(output);
    assert.ok(validated);

    // "send nothing else" -> reply must be empty, action must be hold
    assert.strictEqual(output.reply, '');
    assert.strictEqual(output.action, 'hold');

    // Tool call must include markOptOut
    assert.strictEqual(output.toolCalls.length, 1);
    assert.strictEqual(output.toolCalls[0]?.tool, 'markOptOut');
    assert.deepStrictEqual(output.toolCalls[0]?.input, { customerId: 'cust_001' });
    assert.deepStrictEqual(output.toolCalls[0]?.output, { optedOut: true, success: true });

    // Customer record in repository is now opted out
    const afterCust = await repository.getCustomer('cust_001');
    assert.strictEqual(afterCust?.isOptedOut, true);

    // Fake LLM was not invoked (zero model hallucinations on opt-out)
    assert.strictEqual(fakeLLM.invocations.length, 0);
  });

  it('Uses Fake LLM to answer balance inquiry and calls getBalance tool', async () => {
    // Configure fake LLM to request getBalance and draft a friendly reply
    fakeLLM.setResponse({
      reply: 'Hi Sarah, your current balance is $1,450.00.',
      action: 'send',
      reason: 'Balance inquiry fulfilled',
      toolCallsToExecute: [{ tool: 'getBalance', customerId: 'cust_001' }]
    });

    const input = {
      customerId: 'cust_001',
      message: 'What is my current balance?',
      receivedAt: '2026-11-15T15:00:00Z', // 10:00 AM EST (within 8am-9pm window)
      customerTimezone: 'America/New_York'
    };

    const output = await agent.processInboundSMS(input);

    // Validate schema
    AgentOutputSchema.parse(output);

    assert.strictEqual(output.action, 'send');
    assert.strictEqual(output.reply, 'Hi Sarah, your current balance is $1,450.00.');
    assert.strictEqual(output.toolCalls.length, 1);
    assert.strictEqual(output.toolCalls[0]?.tool, 'getBalance');
    assert.deepStrictEqual(output.toolCalls[0]?.output, { balance: 1450.00, currency: 'USD' });
    assert.strictEqual(fakeLLM.invocations.length, 1);
  });

  it('Overrides action to "hold" during quiet hours outside 8am-9pm', async () => {
    fakeLLM.setResponse({
      reply: 'Your balance is $1,450.00.',
      action: 'send',
      reason: 'Balance inquiry answered'
    });

    // 03:30 AM local time in New York (UTC 08:30)
    const input = {
      customerId: 'cust_001',
      message: 'Balance please',
      receivedAt: '2026-11-15T08:30:00Z',
      customerTimezone: 'America/New_York'
    };

    const output = await agent.processInboundSMS(input);
    AgentOutputSchema.parse(output);

    assert.strictEqual(output.action, 'hold');
    assert.match(output.reason, /outside permissible 8am-9pm window/i);
  });

  it('Returns handoff if customerId is unknown', async () => {
    const input = {
      customerId: 'cust_unknown',
      message: 'Hello',
      receivedAt: '2026-11-15T15:00:00Z',
      customerTimezone: 'America/New_York'
    };

    const output = await agent.processInboundSMS(input);
    AgentOutputSchema.parse(output);

    assert.strictEqual(output.action, 'handoff');
    assert.strictEqual(output.reply, '');
    assert.match(output.reason, /Customer not found/i);
  });

  it('Handles "STOP." with punctuation gracefully and triggers opt-out', async () => {
    const input = {
      customerId: 'cust_002',
      message: '  stop.  ',
      receivedAt: '2026-11-15T14:30:00Z',
      customerTimezone: 'America/New_York'
    };

    const output = await agent.processInboundSMS(input);
    AgentOutputSchema.parse(output);

    assert.strictEqual(output.reply, '');
    assert.strictEqual(output.action, 'hold');
    assert.strictEqual(output.toolCalls[0]?.tool, 'markOptOut');

    const customer = await repository.getCustomer('cust_002');
    assert.strictEqual(customer?.isOptedOut, true);
  });

  it('Gracefully hands off when model throws an exception', async () => {
    fakeLLM.setHandler(() => {
      throw new Error('LLM Provider Rate Limited (429)');
    });

    const input = {
      customerId: 'cust_001',
      message: 'Can I defer my payment?',
      receivedAt: '2026-11-15T15:00:00Z',
      customerTimezone: 'America/New_York'
    };

    const output = await agent.processInboundSMS(input);
    AgentOutputSchema.parse(output);

    assert.strictEqual(output.action, 'handoff');
    assert.strictEqual(output.reply, '');
    assert.match(output.reason, /Model completion failed: LLM Provider Rate Limited/i);
  });

  it('Auto-loads customers from JSON file without requiring manual initialize()', async () => {
    const diskRepo = new CustomerRepository({
      filePath: 'data/customers.json'
    });

    // Directly call getCustomer without calling initialize()
    const customer = await diskRepo.getCustomer('cust_001');
    assert.ok(customer);
    assert.strictEqual(customer.name, 'Sarah Connor');
    assert.strictEqual(customer.balance, 1450.00);

    const balanceRes = await diskRepo.getBalance('cust_002');
    assert.deepStrictEqual(balanceRes, { balance: 0.00, currency: 'USD' });
  });
});
