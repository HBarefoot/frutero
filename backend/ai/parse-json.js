// Robust extractor for JSON objects embedded in LLM responses. The
// model is asked for strict JSON, but smaller/local models occasionally
// wrap output in markdown fences, prefix prose, or trail off with an
// extra paragraph. The previous /\{[\s\S]*\}/ regex was greedy from the
// first '{' to the LAST '}', which corrupts on multi-block output.
//
// Strategy:
//   1. JSON.parse the trimmed text directly (clean case).
//   2. Strip ```json or ``` fences if present, parse the inside.
//   3. Walk balanced braces from the first '{', tracking string context
//      so that '{' or '}' inside a string literal don't move the depth
//      counter. Return the first balanced object that parses.

function extractJsonBlock(rawText) {
  const trimmed = (rawText || '').trim();
  if (!trimmed) throw new Error('model response was empty');

  try { return JSON.parse(trimmed); } catch { /* fall through */ }

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch { /* fall through */ }
  }

  const start = trimmed.indexOf('{');
  if (start === -1) throw new Error('model response was not JSON');

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = trimmed.slice(start, i + 1);
        return JSON.parse(candidate);
      }
    }
  }
  throw new Error('unterminated JSON object in model response');
}

module.exports = { extractJsonBlock };
