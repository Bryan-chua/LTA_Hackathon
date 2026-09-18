import type { ProviderMetadata } from "./domain";

export interface ProviderResult<T> {
  data: T;
  metadata: ProviderMetadata;
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly code: "configuration" | "authentication" | "rate_limit" | "invalid_response" | "timeout" | "unavailable",
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export const providerMetadata = (
  source: string,
  mode: ProviderMetadata["mode"],
  options: Partial<Omit<ProviderMetadata, "source" | "mode" | "fetchedAt" | "warnings">> & {
    fetchedAt?: string;
    warnings?: string[];
  } = {},
): ProviderMetadata => ({
  source,
  mode,
  fetchedAt: options.fetchedAt ?? new Date().toISOString(),
  validFrom: options.validFrom,
  validTo: options.validTo,
  staleAt: options.staleAt,
  warnings: options.warnings ?? [],
});

export async function providerFetch(
  provider: string,
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 8_000,
): Promise<Response> {
  const attempt = async () => {
    try {
      return await fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new ProviderError(provider, "timeout", `${provider} timed out.`, true);
      }
      throw new ProviderError(provider, "unavailable", `${provider} is unavailable.`, true);
    }
  };

  let response = await attempt();
  if (response.status >= 500) response = await attempt();
  if (response.status === 401 || response.status === 403) {
    throw new ProviderError(provider, "authentication", `${provider} rejected its server-side credentials.`);
  }
  if (response.status === 429) throw new ProviderError(provider, "rate_limit", `${provider} rate limit reached.`, true);
  if (!response.ok) throw new ProviderError(provider, "unavailable", `${provider} returned HTTP ${response.status}.`, response.status >= 500);
  return response;
}
