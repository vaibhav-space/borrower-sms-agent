import { InboundSMSSchema, AgentOutputSchema } from './schemas.js';
import { InboundSMS, AgentOutput, ToolCallRecord, AgentAction } from './types.js';
import { CustomerRepository } from './repository.js';
import { ComplianceEngine } from './compliance.js';
import { ToolRegistry } from './tools/registry.js';
import { ILLMClient } from './llm/interface.js';

export interface SMSAgentOptions {
  repository: CustomerRepository;
  llmClient: ILLMClient;
  compliance?: ComplianceEngine;
  toolRegistry?: ToolRegistry;
}

export class SMSAgent {
  private repository: CustomerRepository;
  private llmClient: ILLMClient;
  private compliance: ComplianceEngine;
  private toolRegistry: ToolRegistry;

  constructor(options: SMSAgentOptions) {
    this.repository = options.repository;
    this.llmClient = options.llmClient;
    this.compliance = options.compliance ?? new ComplianceEngine();
    this.toolRegistry = options.toolRegistry ?? new ToolRegistry();
  }

  public async processInboundSMS(rawInput: unknown): Promise<AgentOutput> {
    // 1. Schema Validation on Inbound SMS
    const parseResult = InboundSMSSchema.safeParse(rawInput);
    if (!parseResult.success) {
      const errorMsg = parseResult.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(', ');
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
    if (this.compliance.isOptOut(input.message)) {
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

    // 3. Deterministic In-Code Rule: Inbound Disputes Route Directly to Human Handoff
    if (this.compliance.isDispute(input.message)) {
      return AgentOutputSchema.parse({
        reply: 'I have routed your message to a loan specialist who will review your account records and follow up.',
        toolCalls: [],
        action: 'handoff',
        reason: 'Borrower raised an account dispute, payment claim, or legal contest requiring human representative intervention.'
      });
    }

    // 4. Customer Existence Verification
    const customer = await this.repository.getCustomer(input.customerId);
    if (!customer) {
      return AgentOutputSchema.parse({
        reply: '',
        toolCalls: [],
        action: 'handoff',
        reason: `Customer not found with id: ${input.customerId}`
      });
    }

    // 5. Prior Opt-Out Guardrail Check
    if (customer.isOptedOut) {
      return AgentOutputSchema.parse({
        reply: '',
        toolCalls: [],
        action: 'hold',
        reason: 'Customer has opted out of SMS communications. Outbound reply held.'
      });
    }

    // 6. Invoke LLM via decoupled interface
    let llmResponse;
    try {
      llmResponse = await this.llmClient.complete({
        systemPrompt:
          'You are a compliant financial collections assistant. Do not reveal other customers data. Do not mention balance in first message unless borrower asks.',
        messages: [
          {
            role: 'user',
            content: `Customer ID: ${customer.id}, Name: ${customer.name}. Inbound message: "${input.message}".`
          }
        ],
        availableTools: this.toolRegistry.getToolDefinitions()
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

    // 7. Execute tools through modular ToolRegistry
    if (llmResponse.toolCallsToExecute && llmResponse.toolCallsToExecute.length > 0) {
      for (const proposal of llmResponse.toolCallsToExecute) {
        const record = await this.toolRegistry.executeToolCall(proposal, {
          expectedCustomerId: input.customerId,
          repository: this.repository
        });
        toolCalls.push(record);

        // Security / Tool error check
        if ('error' in record.output) {
          finalAction = 'handoff';
          finalReason = `Tool execution failed for ${record.tool}: ${record.output.error}`;
        } else if (record.tool === 'markOptOut') {
          // If customer opted out via tool call, suppress outbound text
          finalAction = 'hold';
          finalReply = '';
          finalReason = 'Customer opted out via tool call; reply suppressed.';
        }
      }
    }

    // 8. Post-LLM In-Code Guardrail: Cross-Customer Privacy Scanner
    const allCustomers = await this.repository.getAllCustomers();
    const privacyCheck = this.compliance.containsForeignCustomerData(
      finalReply,
      input.customerId,
      allCustomers
    );
    if (privacyCheck.hasLeak) {
      finalReply = '';
      finalAction = 'handoff';
      const privacyViolation = `Privacy violation detected in model draft: Leaked foreign customer data (${privacyCheck.leakedEntity}). Blocked by in-code privacy guardrail.`;
      finalReason = finalReason && finalReason !== llmResponse.reason
        ? `${finalReason}. ${privacyViolation}`
        : privacyViolation;
    }

    // 9. Post-LLM In-Code Guardrail: First-Reply Amount Owed Disclosure Policy
    // In collections, do not mention amount owed in first reply unless borrower explicitly asks.
    const isFirstContact = input.isFirstMessage ?? true;
    if (
      isFirstContact &&
      !this.compliance.isAskingForAmount(input.message) &&
      this.compliance.containsMonetaryAmount(finalReply)
    ) {
      finalReply = this.compliance.getSafeFirstReplyTemplate();
      finalReason = `${finalReason} (Note: Amount owed omitted from first reply per disclosure policy)`;
    }

    // 10. Post-LLM In-Code Guardrail: TCPA Quiet Hours Evaluation (8am - 9pm local time)
    const quietCheck = this.compliance.isQuietHours(input.receivedAt, input.customerTimezone);
    if (quietCheck.isQuiet && finalAction === 'send') {
      finalAction = 'hold';
      finalReason = `${finalReason}. Note: Action overridden to 'hold' because local time is outside permissible 8am-9pm window.`;
    }

    // 11. Validate and return final structured JSON
    return AgentOutputSchema.parse({
      reply: finalReply,
      toolCalls,
      action: finalAction,
      reason: finalReason
    });
  }
}
