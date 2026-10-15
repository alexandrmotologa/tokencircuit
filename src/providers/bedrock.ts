import crypto from 'node:crypto';
import type { NormalizedLLMRequest, NormalizedLLMResponse } from '../core/types.js';
import type { LLMProvider, ProviderExecutionError } from './base.js';
import { PayloadTranslator } from '../core/router/translator.js';

export class BedrockProvider implements LLMProvider {
  public id = 'bedrock';
  public name = 'AWS Bedrock';
  private region: string;
  private timeoutMs: number;
  private accessKeyId?: string;
  private secretAccessKey?: string;
  private sessionToken?: string;

  constructor(options?: {
    region?: string;
    timeoutMs?: number;
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
  }) {
    this.region = options?.region || process.env.AWS_REGION || 'us-east-1';
    this.timeoutMs = options?.timeoutMs || 10000;
    this.accessKeyId = options?.accessKeyId || process.env.AWS_ACCESS_KEY_ID;
    this.secretAccessKey = options?.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY;
    this.sessionToken = options?.sessionToken || process.env.AWS_SESSION_TOKEN;
  }

  private signSigV4(
    method: string,
    endpointUrl: URL,
    headers: Record<string, string>,
    payloadBody: string
  ): Record<string, string> {
    const accessKey = this.accessKeyId!;
    const secretKey = this.secretAccessKey!;
    const date = new Date();
    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);

    headers['host'] = endpointUrl.host;
    headers['x-amz-date'] = amzDate;
    if (this.sessionToken) {
      headers['x-amz-security-token'] = this.sessionToken;
    }

    const canonicalUri = endpointUrl.pathname;
    const canonicalQuerystring = '';
    const sortedHeaderKeys = Object.keys(headers).sort();
    const canonicalHeaders = sortedHeaderKeys.map((k) => `${k.toLowerCase()}:${headers[k].trim()}\n`).join('');
    const signedHeaders = sortedHeaderKeys.map((k) => k.toLowerCase()).join(';');

    const payloadHash = crypto.createHash('sha256').update(payloadBody, 'utf8').digest('hex');
    headers['x-amz-content-sha256'] = payloadHash;

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuerystring,
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join('\n');

    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${this.region}/bedrock/aws4_request`;
    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex')
    ].join('\n');

    const kDate = crypto.createHmac('sha256', `AWS4${secretKey}`).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(this.region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update('bedrock').digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

    headers['Authorization'] = `${algorithm} Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return headers;
  }

  public async execute(
    request: NormalizedLLMRequest,
    modelOverride?: string
  ): Promise<NormalizedLLMResponse> {
    const model = modelOverride || request.model || 'anthropic.claude-3-5-sonnet-20241022-v2:0';
    const payload = PayloadTranslator.toAnthropicPayload(request, model);

    if (!this.accessKeyId || !this.secretAccessKey) {
      const err = new Error(
        `AWS Bedrock credentials missing or unconfigured. Provide AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.`
      ) as ProviderExecutionError;
      err.statusCode = 401;
      err.providerId = this.id;
      err.isRetryable = false;
      throw err;
    }

    const payloadBody = JSON.stringify(payload);
    const endpoint = `https://bedrock-runtime.${this.region}.amazonaws.com/model/${encodeURIComponent(model)}/invoke`;
    const url = new URL(endpoint);

    const initialHeaders: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json'
    };

    const signedHeaders = this.signSigV4('POST', url, initialHeaders, payloadBody);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: signedHeaders,
        body: payloadBody,
        signal: controller.signal
      });

      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`Bedrock API error (${res.status}): ${text}`) as ProviderExecutionError;
        err.statusCode = res.status;
        err.providerId = this.id;
        err.isRetryable = [429, 500, 502, 503, 504].includes(res.status);
        err.rawResponse = text;
        throw err;
      }

      const data = await res.json();
      return {
        id: data.id || `bedrock-${Date.now()}`,
        model,
        content: data.content?.[0]?.text || '',
        role: 'assistant',
        usage: {
          promptTokens: data.usage?.input_tokens || 0,
          completionTokens: data.usage?.output_tokens || 0,
          totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
        },
        finishReason: 'stop'
      };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        const err = new Error(`AWS Bedrock request timed out after ${this.timeoutMs}ms`) as ProviderExecutionError;
        err.statusCode = 504;
        err.providerId = this.id;
        err.isRetryable = true;
        throw err;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
