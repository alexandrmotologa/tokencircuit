import type { NormalizedLLMRequest, NormalizedLLMResponse } from '../core/types.js';

export interface ProviderExecutionError extends Error {
  statusCode?: number;
  providerId: string;
  isRetryable: boolean;
  rawResponse?: string;
}

export interface LLMProvider {
  id: string;
  name: string;
  execute(
    request: NormalizedLLMRequest,
    modelOverride?: string
  ): Promise<NormalizedLLMResponse>;
  executeStream?(
    request: NormalizedLLMRequest,
    modelOverride?: string,
    onChunk?: (delta: string) => void
  ): Promise<NormalizedLLMResponse>;
}
