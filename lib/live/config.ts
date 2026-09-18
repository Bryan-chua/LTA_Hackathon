import { ProviderError } from "../provider-contracts";

export function assertLiveProvidersEnabled() {
  if (process.env.LIVE_PROVIDERS_ENABLED !== "true") {
    throw new ProviderError("Live providers", "configuration", "Live provider access is disabled on this deployment.");
  }
}
