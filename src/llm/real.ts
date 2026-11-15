import { ILLMClient, LLMRequest, LLMResponse, LLMToolCallProposal } from './interface.js';

export interface RealLLMClientOptions {
  apiKey?: string;
  provider?: 'gemini' | 'openai';
  model?: string;
  timeoutMs?: number;
}

function parseToolProposals(items: unknown): LLMToolCallProposal[] | undefined {
  if (!Array.isArray(items)) {
    return undefined;
  }
  const result: LLMToolCallProposal[] = [];
  for (const item of items) {
    if (
      typeof item === 'object' &&
      item !== null &&
      'tool' in item &&
      (item.tool === 'getBalance' ||
        item.tool === 'markOptOut' ||
        item.tool === 'createPaymentLink') &&
      'customerId' in item &&
      typeof item.customerId === 'string'
    ) {
      const amount =
        'amount' in item && typeof item.amount === 'number' ? item.amount : undefined;
      result.push({
        tool: item.tool,
        customerId: item.customerId,
        amount
      });
    }
  }
  return result.length > 0 ? result : undefined;
}

export class RealLLMClient implements ILLMClient {
  private apiKey: string;
  private provider: 'gemini' | 'openai';
  private model: string;
  private timeoutMs: number;

  constructor(options?: RealLLMClientOptions) {
    this.apiKey =
      options?.apiKey ||
      process.env.GEMINI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      '';
    this.provider =
      options?.provider ||
      (process.env.GEMINI_API_KEY ? 'gemini' : 'openai');
    this.model =
      options?.model ||
      (this.provider === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o-mini');
    this.timeoutMs = options?.timeoutMs || 10000;
  }

  public async complete(request: LLMRequest): Promise<LLMResponse> {
    if (!this.apiKey) {
      throw new Error(
        'RealLLMClient requires an API key. Set GEMINI_API_KEY or OPENAI_API_KEY in your environment.'
      );
    }

    if (this.provider === 'gemini') {
      return this.callGemini(request);
    }
    return this.callOpenAI(request);
  }

  private async callGemini(request: LLMRequest): Promise<LLMResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const toolsPrompt = request.availableTools
      ? `Available tools: ${JSON.stringify(request.availableTools)}.`
      : '';
    const userText = request.messages.map((m) => `${m.role}: ${m.content}`).join('\n');

    const prompt = `${request.systemPrompt}\n${toolsPrompt}\nRespond in valid JSON matching this schema:\n{"reply": string, "action": "send"|"hold"|"handoff", "reason": string, "toolCallsToExecute": [{"tool": string, "customerId": string, "amount": number}]}\n\nUser:\n${userText}`;

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const data: unknown = await response.json();
    if (
      typeof data === 'object' &&
      data !== null &&
      'candidates' in data &&
      Array.isArray(data.candidates) &&
      data.candidates[0]?.content?.parts?.[0]?.text
    ) {
      const text = data.candidates[0].content.parts[0].text;
      const parsed: unknown = JSON.parse(text);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'reply' in parsed &&
        typeof parsed.reply === 'string' &&
        'action' in parsed &&
        (parsed.action === 'send' || parsed.action === 'hold' || parsed.action === 'handoff') &&
        'reason' in parsed &&
        typeof parsed.reason === 'string'
      ) {
        return {
          reply: parsed.reply,
          action: parsed.action,
          reason: parsed.reason,
          toolCallsToExecute:
            'toolCallsToExecute' in parsed
              ? parseToolProposals(parsed.toolCallsToExecute)
              : undefined
        };
      }
    }

    throw new Error('Failed to parse structured response from Gemini API');
  }

  private async callOpenAI(request: LLMRequest): Promise<LLMResponse> {
    const url = 'https://api.openai.com/v1/chat/completions';
    const messages = [
      {
        role: 'system',
        content: `${request.systemPrompt} Respond in JSON with keys: reply, action, reason, toolCallsToExecute.`
      },
      ...request.messages
    ];

    const body = {
      model: this.model,
      messages,
      response_format: { type: 'json_object' }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data: unknown = await response.json();
    if (
      typeof data === 'object' &&
      data !== null &&
      'choices' in data &&
      Array.isArray(data.choices) &&
      data.choices[0]?.message?.content
    ) {
      const text = data.choices[0].message.content;
      const parsed: unknown = JSON.parse(text);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'reply' in parsed &&
        typeof parsed.reply === 'string' &&
        'action' in parsed &&
        (parsed.action === 'send' || parsed.action === 'hold' || parsed.action === 'handoff') &&
        'reason' in parsed &&
        typeof parsed.reason === 'string'
      ) {
        return {
          reply: parsed.reply,
          action: parsed.action,
          reason: parsed.reason,
          toolCallsToExecute:
            'toolCallsToExecute' in parsed
              ? parseToolProposals(parsed.toolCallsToExecute)
              : undefined
        };
      }
    }

    throw new Error('Failed to parse structured response from OpenAI API');
  }
}
