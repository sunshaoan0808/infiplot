export function parseJsonLoose<T>(raw: string): T {
  const trimmed = raw.trim();

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // fall through
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]) as T;
    } catch {
      // fall through
    }
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    const slice = trimmed.slice(first, last + 1);
    return JSON.parse(slice) as T;
  }

  throw new Error(`Failed to parse JSON from model output: ${raw.slice(0, 200)}`);
}
