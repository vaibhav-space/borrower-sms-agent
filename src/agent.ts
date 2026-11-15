import { InboundSMSSchema, AgentOutputSchema } from './schemas.js';
import { InboundSMS, AgentOutput, ToolCallRecord, AgentAction } from './types.js';
import { CustomerRepository } from './repository.js';
import { ComplianceEngine } from './compliance.js';
import { ILLMClient } from './llm/interface.js';

export interface SMSAgentOptions {
  repository: CustomerRepository;
  llmClient: ILLMClient;
}

export class SMSAgent {
  private repository: CustomerRepository;
  private llmClient: ILLMClient;

  constructor(options: SMSAgentOptions) {
    this.repository = options.repository;
    this.llmClient = options.llmClient;
  }

  public async processInboundSMS(rawInput: unknown): Promise<AgentOutput> {
    // 1. Schema Validation on Inbound SMS
    const parseResult = InboundSMSSchema.safeParse(rawInput);
    if (!parseResult.success) {
      const errorMsg = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      return AgentOutputSchema.parse({
        reply: '',
        toolCalls: [],
        action: 'handoff',
        reason: `Input validation failed: ${errorMsg}`
      });
    }

    const input: InboundSMS = parseResult.data;
    const toolCalls: ToolCallRecord[] = [];

    // 2. Deterministic Compliance Fast-Path: On "STOP", call markOptOut and send nothing else
    if (ComplianceEngine.isOptOut(input.message)) {
      const optOutResult = await this.repository.markOptOut(input.customerId);
      toolCalls.push({
        tool: 'markOptOut',
        input: { customerId: input.customerId },
        output: optOutResult
      });

      return AgentOutputSchema.parse({
        reply: '',
        toolCalls,
        action: 'hold',
        reason: 'Borrower requested opt-out via STOP; opt-out recorded and outbound messaging halted.'
      });
    }

    // 3. Customer Existence Check
    const customer = await this.repository.getCustomer(input.customerId);
    if (!customer) {
      return AgentOutputSchema.parse({
        reply: '',
        toolCalls: [],
        action: 'handoff',
        reason: `Customer not found with id: ${input.customerId}`
      });
    }

    // 4. Opt-Out Guardrail Check: Never send outbound SMS to an already opted-out customer
    if (customer.isOptedOut) {
      return AgentOutputSchema.parse({
        reply: '',
        toolCalls: [],
        action: 'hold',
        reason: 'Customer has opted out of SMS communications. Outbound reply held.'
      });
    }

    // 5. Invoke LLM via interface with exception safety
    let llmResponse;
    try {
      llmResponse = await this.llmClient.complete({
        systemPrompt: 'You are an accurate, compliant financial assistant for borrowers.',
        messages: [
          {
            role: 'user',
            content: `Customer ID: ${customer.id}, Name: ${customer.name}. Received inbound message: "${input.message}".`
          }
        ],
        availableTools: [
          { name: 'getBalance', description: 'Retrieve the borrower current balance.' },
          { name: 'markOptOut', description: 'Mark the borrower as opted-out.' }
        ]
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown LLM error';
      return AgentOutputSchema.parse({
        reply: '',
        toolCalls: [],
        action: 'handoff',
        reason: `Model completion failed: ${message}`
      });
    }

    let finalAction: AgentAction = llmResponse.action;
    let finalReason: string = llmResponse.reason;
    let finalReply: string = llmResponse.reply;

    // 6. Execute any tools requested by the model
    if (llmResponse.toolCallsToExecute && llmResponse.toolCallsToExecute.length > 0) {
      for (const call of llmResponse.toolCallsToExecute) {
        if (call.tool === 'getBalance') {
          const balanceResult = await this.repository.getBalance(call.customerId);
          toolCalls.push({
            tool: 'getBalance',
            input: { customerId: call.customerId },
            output: balanceResult
          });
          if ('error' in balanceResult) {
            finalAction = 'handoff';
            finalReason = `Tool execution failed for getBalance: ${balanceResult.error}`;
          }
        } else if (call.tool === 'markOptOut') {
          const optOutResult = await this.repository.markOptOut(call.customerId);
          toolCalls.push({
            tool: 'markOptOut',
            input: { customerId: call.customerId },
            output: optOutResult
          });
          if ('error' in optOutResult) {
            finalAction = 'handoff';
            finalReason = `Tool execution failed for markOptOut: ${optOutResult.error}`;
          } else {
            // Customer opted out during tool execution -> suppress outbound message
            finalAction = 'hold';
            finalReply = '';
            finalReason = 'Customer opted out via tool call; reply suppressed.';
          }
        }
      }
    }

    // 7. Quiet Hours Evaluation (TCPA / CFPB Reg F: 8am - 9pm local time)
    const quietCheck = ComplianceEngine.isQuietHours(input.receivedAt, input.customerTimezone);
    if (quietCheck.isQuiet && finalAction === 'send') {
      finalAction = 'hold';
      finalReason = `${finalReason}. Note: Action overridden to 'hold' because local time is outside permissible 8am-9pm window.`;
    }

    // 8. Validate and return final structured JSON
    return AgentOutputSchema.parse({
      reply: finalReply,
      toolCalls,
      action: finalAction,
      reason: finalReason
    });
  }
}
