import { AgentAction } from '../types.js';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMToolDefinition {
  name: 'getBalance' | 'markOptOut' | 'createPaymentLink';
  description: string;
  parameters?: Record<string, string> | undefined;
}

export interface LLMToolCallProposal {
  tool: 'getBalance' | 'markOptOut' | 'createPaymentLink';
  customerId: string;
  amount?: number | undefined;
}

export interface LLMRequest {
  systemPrompt: string;
  messages: LLMMessage[];
  availableTools?: LLMToolDefinition[] | undefined;
}

export interface LLMResponse {
  reply: string;
  action: AgentAction;
  reason: string;
  toolCallsToExecute?: LLMToolCallProposal[] | undefined;
}

export interface ILLMClient {
  complete(request: LLMRequest): Promise<LLMResponse>;
}
