import { AgentAction } from '../types.js';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMToolDefinition {
  name: 'getBalance' | 'markOptOut';
  description: string;
}

export interface LLMRequest {
  systemPrompt: string;
  messages: LLMMessage[];
  availableTools?: LLMToolDefinition[];
}

export interface LLMToolCallProposal {
  tool: 'getBalance' | 'markOptOut';
  customerId: string;
}

export interface LLMResponse {
  reply: string;
  action: AgentAction;
  reason: string;
  toolCallsToExecute?: LLMToolCallProposal[];
}

export interface ILLMClient {
  complete(request: LLMRequest): Promise<LLMResponse>;
}
