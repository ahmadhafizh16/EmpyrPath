/**
 * Token Usage Tracking - Extract, normalize, estimate and log token usage
 */

import { saveRequestUsage, appendRequestLog } from "@/lib/usageDb.js";
import { FORMATS } from "../translator/formats.js";

// ANSI color codes
export const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m"
};

// Buffer tokens to prevent context errors
const BUFFER_TOKENS = 2000;

// Get HH:MM:SS timestamp
function getTimeString() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Add buffer tokens to usage to prevent context errors
 * @param {object} usage - Usage object (any format)
 * @returns {object} Usage with buffer added
 */
export function addBufferToUsage(usage) {
  if (!usage || typeof usage !== "object") return usage;

  const result = { ...usage };

  // Claude format
  if (result.input_tokens !== undefined) {
    result.input_tokens += BUFFER_TOKENS;
  }

  // OpenAI format
  if (result.prompt_tokens !== undefined) {
    result.prompt_tokens += BUFFER_TOKENS;
  }

  // Calculate or update total_tokens
  if (result.total_tokens !== undefined) {
    result.total_tokens += BUFFER_TOKENS;
  } else if (result.prompt_tokens !== undefined && result.completion_tokens !== undefined) {
    // Calculate total_tokens if not exists
    result.total_tokens = result.prompt_tokens + result.completion_tokens;
  }

  return result;
}

export function filterUsageForFormat(usage, targetFormat) {
  if (!usage || typeof usage !== "object") return usage;

  // Helper to pick only defined fields from usage
  const pickFields = (fields) => {
    const filtered = {};
    for (const field of fields) {
      if (usage[field] !== undefined) {
        filtered[field] = usage[field];
      }
    }
    return filtered;
  };

  // Define allowed fields for each format
  const formatFields = {
    [FORMATS.CLAUDE]: [
      'input_tokens', 'output_tokens', 
      'cache_read_input_tokens', 'cache_creation_input_tokens',
      'estimated'
    ],
    [FORMATS.GEMINI]: [
      'promptTokenCount', 'candidatesTokenCount', 'totalTokenCount',
      'cachedContentTokenCount', 'thoughtsTokenCount',
      'estimated'
    ],
    [FORMATS.OPENAI_RESPONSES]: [
      'input_tokens', 'output_tokens',
      'input_tokens_details', 'output_tokens_details',
      'estimated'
    ],
    // OpenAI format (default for OPENAI, CODEX, KIRO, etc.)
    default: [
      'prompt_tokens', 'completion_tokens', 'total_tokens',
      'cached_tokens', 'reasoning_tokens',
      'prompt_tokens_details', 'completion_tokens_details',
      'estimated'
    ]
  };

  // Get fields for target format
  let fields = formatFields[targetFormat];
  
  // Use same fields for similar formats
  if (targetFormat === FORMATS.GEMINI_CLI || targetFormat === FORMATS.ANTIGRAVITY) {
    fields = formatFields[FORMATS.GEMINI];
  } else if (targetFormat === FORMATS.OPENAI_RESPONSE) {
    fields = formatFields[FORMATS.OPENAI_RESPONSES];
  } else if (!fields) {
    fields = formatFields.default;
  }

  return pickFields(fields);
}

/**
 * Normalize usage object - ensure all values are valid numbers
 */
export function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;

  const normalized = {};
  const assignNumber = (key, value) => {
    if (value === undefined || value === null) return;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) normalized[key] = numeric;
  };

  assignNumber("prompt_tokens", usage?.prompt_tokens);
  assignNumber("completion_tokens", usage?.completion_tokens);
  assignNumber("total_tokens", usage?.total_tokens);
  assignNumber("cache_read_input_tokens", usage?.cache_read_input_tokens);
  assignNumber("cache_creation_input_tokens", usage?.cache_creation_input_tokens);
  assignNumber("cached_tokens", usage?.cached_tokens);
  assignNumber("reasoning_tokens", usage?.reasoning_tokens);

  // Preserve nested details objects for OpenAI format forwarding
  if (usage?.prompt_tokens_details && typeof usage.prompt_tokens_details === "object") {
    normalized.prompt_tokens_details = usage.prompt_tokens_details;
  }
  if (usage?.completion_tokens_details && typeof usage.completion_tokens_details === "object") {
    normalized.completion_tokens_details = usage.completion_tokens_details;
  }

  if (Object.keys(normalized).length === 0) return null;
  return normalized;
}

/**
 * Check if usage has valid token data
 * Valid = has at least one token field with value > 0
 * Invalid = empty object {}, null, undefined, no token fields, or all zeros
 */
export function hasValidUsage(usage) {
  if (!usage || typeof usage !== "object") return false;

  // Check for any known token field with value > 0
  const tokenFields = [
    "prompt_tokens", "completion_tokens", "total_tokens",  // OpenAI
    "input_tokens", "output_tokens",                        // Claude
    "promptTokenCount", "candidatesTokenCount"              // Gemini
  ];

  for (const field of tokenFields) {
    if (typeof usage[field] === "number" && usage[field] > 0) {
      return true;
    }
  }

  return false;
}

/**
 * Merge a newly-extracted usage object into the running accumulator.
 *
 * Anthropic streaming splits usage across two SSE events: input_tokens arrive
 * in `message_start` (with output_tokens: 1 as a placeholder), final
 * output_tokens arrive in `message_delta`. Replacing instead of merging loses
 * input_tokens because the delta event reports them as 0. Per-field max
 * resolves this safely:
 *   - output_tokens in message_delta is the FINAL cumulative value (not a
 *     per-chunk delta), so max-of-stream gives the right answer.
 *   - cache_read_input_tokens / cache_creation_input_tokens typically appear
 *     only on message_start; max keeps them.
 * For OpenAI/Gemini providers that emit a single final usage chunk, the prior
 * accumulator is empty so max degenerates to "use the new value."
 */
export function mergeUsage(prev, next) {
  if (!prev) return next;
  if (!next) return prev;
  const merged = { ...prev };
  for (const [k, v] of Object.entries(next)) {
    if (typeof v === "number") {
      merged[k] = Math.max(merged[k] ?? 0, v);
    } else if (v !== undefined && v !== null) {
      // Non-numeric (e.g. *_details objects): prefer the latest.
      merged[k] = v;
    }
  }
  return merged;
}

/**
 * Extract usage from any format (Claude, OpenAI, Gemini, Responses API)
 */
export function extractUsage(chunk) {
  if (!chunk || typeof chunk !== "object") return null;

  // Claude format (message_start) — carries input_tokens (+ cache reads) and a
  // placeholder output_tokens: 1. We must capture this event because Anthropic
  // splits usage across two SSE events: input on message_start, final output
  // on message_delta. Skipping it leaves prompt_tokens=0 (the bug seen on
  // anthropic-compatible providers like mimo).
  if (chunk.type === "message_start" && chunk.message?.usage && typeof chunk.message.usage === "object") {
    const u = chunk.message.usage;
    return normalizeUsage({
      prompt_tokens: u.input_tokens || 0,
      completion_tokens: u.output_tokens || 0,
      cache_read_input_tokens: u.cache_read_input_tokens,
      cache_creation_input_tokens: u.cache_creation_input_tokens
    });
  }

  // Claude format (message_delta event) — carries final output_tokens. Some
  // providers also re-emit input_tokens here; prefer the higher value when
  // merging in the accumulator.
  if (chunk.type === "message_delta" && chunk.usage && typeof chunk.usage === "object") {
    return normalizeUsage({
      prompt_tokens: chunk.usage.input_tokens || 0,
      completion_tokens: chunk.usage.output_tokens || 0,
      cache_read_input_tokens: chunk.usage.cache_read_input_tokens,
      cache_creation_input_tokens: chunk.usage.cache_creation_input_tokens
    });
  }

  // OpenAI Responses API format (response.completed or response.done)
  if ((chunk.type === "response.completed" || chunk.type === "response.done") && chunk.response?.usage && typeof chunk.response.usage === "object") {
    const usage = chunk.response.usage;
    const cachedTokens = usage.input_tokens_details?.cached_tokens;
    return normalizeUsage({
      prompt_tokens: usage.input_tokens || usage.prompt_tokens || 0,
      completion_tokens: usage.output_tokens || usage.completion_tokens || 0,
      cached_tokens: cachedTokens,
      reasoning_tokens: usage.output_tokens_details?.reasoning_tokens,
      prompt_tokens_details: cachedTokens ? { cached_tokens: cachedTokens } : undefined
    });
  }

  // OpenAI format (also covers DeepSeek which uses prompt_cache_hit_tokens)
  if (chunk.usage && typeof chunk.usage === "object" && chunk.usage.prompt_tokens !== undefined) {
    return normalizeUsage({
      prompt_tokens: chunk.usage.prompt_tokens,
      completion_tokens: chunk.usage.completion_tokens || 0,
      cached_tokens: chunk.usage.prompt_tokens_details?.cached_tokens || chunk.usage.prompt_cache_hit_tokens,
      reasoning_tokens: chunk.usage.completion_tokens_details?.reasoning_tokens,
      prompt_tokens_details: chunk.usage.prompt_tokens_details,
      completion_tokens_details: chunk.usage.completion_tokens_details
    });
  }

  // Gemini format (Antigravity)
  // Antigravity wraps usageMetadata inside response: { response: { usageMetadata: {...} } }
  const usageMeta = chunk.usageMetadata || chunk.response?.usageMetadata;
  if (usageMeta && typeof usageMeta === "object") {
    return normalizeUsage({
      prompt_tokens: usageMeta.promptTokenCount || 0,
      completion_tokens: usageMeta.candidatesTokenCount || 0,
      total_tokens: usageMeta.totalTokenCount,
      cached_tokens: usageMeta.cachedContentTokenCount,
      reasoning_tokens: usageMeta.thoughtsTokenCount
    });
  }

  // Ollama NDJSON format (raw from provider, before translation)
  // Ollama sends: {"model":"...","done":true,"prompt_eval_count":N,"eval_count":M}
  if (chunk.done === true && typeof chunk.prompt_eval_count === "number") {
    return normalizeUsage({
      prompt_tokens: chunk.prompt_eval_count || 0,
      completion_tokens: chunk.eval_count || 0,
      total_tokens: (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0)
    });
  }

  return null;
}

/**
 * Estimate input tokens from request body
 * Calculate total body size for more accurate estimation
 */
export function estimateInputTokens(body) {
  if (!body || typeof body !== "object") return 0;

  try {
    // Calculate total body size (includes messages, tools, system, thinking config, etc.)
    const bodyStr = JSON.stringify(body);
    const totalChars = bodyStr.length;

    // Estimate: ~4 chars per token (rough average across all tokenizers)
    return Math.ceil(totalChars / 4);
  } catch (err) {
    // Fallback if stringify fails
    return 0;
  }
}

/**
 * Estimate output tokens from content length
 */
export function estimateOutputTokens(contentLength) {
  if (!contentLength || contentLength <= 0) return 0;
  return Math.max(1, Math.floor(contentLength / 4));
}

/**
 * Format usage object based on target format
 * @param {number} inputTokens - Input/prompt tokens
 * @param {number} outputTokens - Output/completion tokens
 * @param {string} targetFormat - Target format from FORMATS
 */
export function formatUsage(inputTokens, outputTokens, targetFormat) {
  // Claude format uses input_tokens/output_tokens
  if (targetFormat === FORMATS.CLAUDE) {
    return addBufferToUsage({ 
      input_tokens: inputTokens, 
      output_tokens: outputTokens, 
      estimated: true 
    });
  }

  // Default: OpenAI format (works for openai, gemini, responses, etc.)
  return addBufferToUsage({
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    estimated: true
  });
}

/**
 * Estimate full usage when provider doesn't return it
 * @param {object} body - Request body for input token estimation
 * @param {number} contentLength - Content length for output token estimation
 * @param {string} targetFormat - Target format from FORMATS constant
 */
export function estimateUsage(body, contentLength, targetFormat = FORMATS.OPENAI) {
  return formatUsage(
    estimateInputTokens(body),
    estimateOutputTokens(contentLength),
    targetFormat
  );
}

/**
 * Log usage with cache info (green color)
 */
export function logUsage(provider, usage, model = null, connectionId = null, apiKey = null) {
  if (!usage || typeof usage !== "object") return;

  const p = provider?.toUpperCase() || "UNKNOWN";

  // Support both formats:
  // - OpenAI: prompt_tokens, completion_tokens
  // - Claude: input_tokens, output_tokens
  const inTokens = usage?.prompt_tokens || usage?.input_tokens || 0;
  const outTokens = usage?.completion_tokens || usage?.output_tokens || 0;
  const accountPrefix = connectionId ? connectionId.slice(0, 8) + "..." : "unknown";

  let msg = `[${getTimeString()}] 📊 ${COLORS.green}[USAGE] ${p} | in=${inTokens} | out=${outTokens} | account=${accountPrefix}${COLORS.reset}`;

  // Add estimated flag if present
  if (usage.estimated) {
    msg += ` ${COLORS.yellow}(estimated)${COLORS.reset}`;
  }

  // Add cache info if present (unified from different formats)
  const cacheRead = usage.cache_read_input_tokens || usage.cached_tokens || usage.prompt_tokens_details?.cached_tokens;
  if (cacheRead) msg += ` | cache_read=${cacheRead}`;

  const cacheCreation = usage.cache_creation_input_tokens;
  if (cacheCreation) msg += ` | cache_create=${cacheCreation}`;

  const reasoning = usage.reasoning_tokens;
  if (reasoning) msg += ` | reasoning=${reasoning}`;

  console.log(msg);

  // DB writes intentionally happen elsewhere: streaming flushes a single
  // saveUsageStats call from buildOnStreamComplete (chatCore/streamingHandler)
  // using the same `usage` object that drives this log. Writing here too
  // double-counted every streaming request — visible as identical-millisecond
  // duplicate rows in usageHistory and 2× drains against per-key + subscription
  // counters. Keep the pretty console log; the DB write lives in one place.
}
