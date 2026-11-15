import { CustomerRepository } from '../repository.js';
import { ToolResult, ToolCallRecord } from '../types.js';
import { LLMToolDefinition, LLMToolCallProposal } from '../llm/interface.js';

export interface ToolContext {
  expectedCustomerId: string;
  repository: CustomerRepository;
}

export interface ToolDefinition {
  name: 'getBalance' | 'markOptOut' | 'createPaymentLink';
  description: string;
  parameters?: Record<string, string> | undefined;
  execute(
    args: { customerId: string; amount?: number | undefined },
    context: ToolContext
  ): Promise<ToolResult>;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  constructor() {
    this.registerDefaultTools();
  }

  public register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  public getToolDefinitions(): LLMToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }));
  }

  public async executeToolCall(
    proposal: LLMToolCallProposal,
    context: ToolContext
  ): Promise<ToolCallRecord> {
    const handler = this.tools.get(proposal.tool);

    // Cross-customer security boundary enforced at tool level
    if (proposal.customerId !== context.expectedCustomerId) {
      return {
        tool: proposal.tool,
        input: { customerId: proposal.customerId, amount: proposal.amount },
        output: {
          error: `Cross-customer security violation: Requested customerId '${proposal.customerId}' does not match authenticated borrower '${context.expectedCustomerId}'`
        }
      };
    }

    if (!handler) {
      return {
        tool: proposal.tool,
        input: { customerId: proposal.customerId, amount: proposal.amount },
        output: { error: `Tool not registered: ${proposal.tool}` }
      };
    }

    const output = await handler.execute(
      { customerId: proposal.customerId, amount: proposal.amount },
      context
    );

    return {
      tool: proposal.tool,
      input: { customerId: proposal.customerId, amount: proposal.amount },
      output
    };
  }

  private registerDefaultTools(): void {
    // 1. getBalance tool
    this.register({
      name: 'getBalance',
      description: 'Retrieve the current loan balance for the authenticated borrower.',
      execute: async (args, context) => {
        return context.repository.getBalance(args.customerId);
      }
    });

    // 2. markOptOut tool
    this.register({
      name: 'markOptOut',
      description: 'Mark the borrower as opted-out of automated SMS communications.',
      execute: async (args, context) => {
        return context.repository.markOptOut(args.customerId);
      }
    });

    // 3. createPaymentLink tool
    this.register({
      name: 'createPaymentLink',
      description: 'Generate a secure, single-use payment link for the specified amount.',
      parameters: {
        customerId: 'Borrower customer identifier',
        amount: 'Payment amount in dollars (must be positive number)'
      },
      execute: async (args, context) => {
        if (args.amount === undefined) {
          return { error: 'Amount is required to generate payment link' };
        }
        return context.repository.createPaymentLink(args.customerId, args.amount);
      }
    });
  }
}
