import { ILLMClient, LLMRequest, LLMResponse } from './interface.js';

export type MockHandler = (request: LLMRequest) => Promise<LLMResponse> | LLMResponse;

export class FakeLLMClient implements ILLMClient {
  public invocations: LLMRequest[] = [];
  private defaultResponse: LLMResponse;
  private customHandler: MockHandler | undefined;

  constructor(defaultResponse?: Partial<LLMResponse>, customHandler?: MockHandler) {
    this.defaultResponse = {
      reply: 'Thank you for contacting us. We have received your inquiry.',
      action: 'send',
      reason: 'General inquiry responded to successfully',
      ...defaultResponse
    };
    this.customHandler = customHandler;
  }

  public setResponse(response: Partial<LLMResponse>): void {
    this.defaultResponse = {
      ...this.defaultResponse,
      ...response
    };
  }

  public setHandler(handler: MockHandler): void {
    this.customHandler = handler;
  }

  public async complete(request: LLMRequest): Promise<LLMResponse> {
    this.invocations.push(request);
    if (this.customHandler) {
      return this.customHandler(request);
    }
    return this.defaultResponse;
  }
}
