import { fetchRuntimeConfig } from '@tn4consulting/shared-runtime-config';
import { initBrowserObservability } from '@tn4consulting/shared-observability';

/**
 * Replaces environment.ts/environment.prod.ts + fileReplacements -- see
 * CLAUDE.md's Hosting section. Under plain `nx serve` these dev defaults
 * apply directly; in a container, the entrypoint script injects real values
 * via window.__mfePotEnv from the Helm chart's ConfigMap.
 *
 * Fetched from this app's own origin (not read off window.__mfePotEnv)
 * because this app is loaded as a Native Federation remote inside the
 * shell as often as it's loaded standalone -- when federated, this app's
 * own index.html/env.js never loads (the shell's already-running page
 * just imports this app's JS module into the same window), so
 * window.__mfePotEnv only ever carries the shell's own values. Fetching
 * this app's own env.js directly from its own origin works in both cases.
 */
const devDefaults = {
  jobBankBffBaseUrl: 'http://localhost:3001',
  strapiBaseUrl: 'http://localhost:1337',
  // undefined -- no local collector needed for plain `nx serve`, see
  // shared-observability's initBrowserObservability.
  otelExporterOtlpEndpoint: undefined as string | undefined,
};

export async function loadRuntimeConfig(ownOriginUrl: string) {
  const config = await fetchRuntimeConfig(ownOriginUrl, devDefaults);
  // Single wiring point for every exposed entry point in this app (App.tsx,
  // JobApplicationsList.tsx as a standalone widget, ...) -- all funnel
  // through this same function. Idempotent, so calling it more than once
  // per session (e.g. both ./Component and a standalone widget mounting) is
  // safe. propagateTraceHeaderCorsUrls matches this app's own BFF Ingress
  // origin on any environment -- see mfe-pot-platform/CLAUDE.md's
  // observability section for why this is required, not optional, for a
  // federated remote's BFF calls.
  initBrowserObservability({
    serviceName: 'job-bank-mfe',
    otlpEndpoint: config.otelExporterOtlpEndpoint,
    propagateTraceHeaderCorsUrls: [/^https?:\/\/job-bank-mfe\./],
  });
  return config;
}
