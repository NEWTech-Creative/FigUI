const SCHEMA_URL =
  "https://raw.githubusercontent.com/bdring/FluidNC/main/tools/fluidnc-config-schema.json";
const CACHE_KEY = "fluidui.fluidnc-schema.v1";
const MAX_SCHEMA_BYTES = 500_000;

export type FluidSchema = {
  $defs?: Record<string, SchemaNode>;
};

export type SchemaNode = {
  $ref?: string;
  type?: string | string[];
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  description?: string;
  properties?: Record<string, SchemaNode>;
  allOf?: SchemaNode[];
};

let pending: Promise<FluidSchema | null> | null = null;

function parseSchema(text: string): FluidSchema | null {
  if (!text || text.length > MAX_SCHEMA_BYTES) return null;
  try {
    const schema = JSON.parse(text) as FluidSchema;
    return schema.$defs?.motorBlock?.properties ? schema : null;
  } catch {
    return null;
  }
}

async function fetchSchema(): Promise<FluidSchema | null> {
  let cached: string | null = null;
  try {
    cached = localStorage.getItem(CACHE_KEY);
  } catch {
    // Storage is optional; the in-bundle definitions remain the final fallback.
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(SCHEMA_URL, {
      signal: controller.signal,
      credentials: "omit",
    });
    if (!response.ok)
      throw new Error(`Schema request failed: ${response.status}`);
    const text = await response.text();
    const schema = parseSchema(text);
    if (!schema) throw new Error("Invalid FluidNC schema response");
    try {
      localStorage.setItem(CACHE_KEY, text);
    } catch {
      // A full/disabled cache must not prevent use of the downloaded schema.
    }
    return schema;
  } catch {
    return cached ? parseSchema(cached) : null;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function loadFluidSchema(): Promise<FluidSchema | null> {
  pending ??= fetchSchema();
  return pending;
}
