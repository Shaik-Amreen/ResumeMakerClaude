/** Live LLM route labels — console + UI while a call is in flight. */

export type LlmGateway = 'OmniRoute' | 'OpenRouter' | 'Ollama' | 'Claude Code';

export type LlmRouteInfo = {
  work: string;
  gateway: LlmGateway;
  requested: string;
  routed?: string;
};

export function formatLlmLabel(info: Pick<LlmRouteInfo, 'gateway' | 'requested' | 'routed'>): string {
  const requested = (info.requested || '').trim();
  const routed = (info.routed || '').trim();
  if (routed && requested && routed !== requested) {
    return `${info.gateway} (${requested} → ${routed})`;
  }
  return `${info.gateway} (${routed || requested || 'unknown'})`;
}

export function logLlmInUse(work: string, label: string): void {
  console.log(`🧠 ${work} — using ${label}`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/** Pull the upstream model id from an OpenAI-compatible chunk or JSON body. */
export function extractRoutedModel(chunk: unknown): string | undefined {
  const root = asRecord(chunk);
  if (!root) return undefined;

  const metadata = asRecord(root.metadata);
  const omni = asRecord(root.omniroute) || asRecord(root.diagnostics);
  const choice0 = Array.isArray(root.choices) ? asRecord(root.choices[0]) : null;

  const alias = firstString(root.model);
  const routed = firstString(
    root.actual_model,
    root.routed_model,
    root.provider_model,
    root.selected_model,
    metadata?.routed_model,
    metadata?.upstream_model,
    metadata?.selected_model,
    omni?.selected_model,
    omni?.upstream_model,
    omni?.model,
    choice0?.model,
    metadata?.model
  );

  if (routed && alias && routed !== alias) return routed;
  if (routed) return routed;
  return alias;
}

export function extractRoutedModelFromHeaders(headers: Headers): string | undefined {
  for (const key of [
    'x-omniroute-model',
    'x-selected-model',
    'x-routed-model',
    'x-model',
    'openai-model',
  ]) {
    const value = headers.get(key);
    if (value?.trim()) return value.trim();
  }
  return undefined;
}
