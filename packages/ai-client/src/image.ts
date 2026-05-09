import type { ProviderConfig } from "@dada/types";

export async function generateImage(
  config: ProviderConfig,
  prompt: string,
  opts?: { size?: string; quality?: "low" | "medium" | "high" | "auto" },
): Promise<string> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/images/generations`;
  const body: Record<string, unknown> = {
    model: config.model,
    prompt,
    size: opts?.size ?? "1024x1536",
    quality: opts?.quality ?? "medium",
    n: 1,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Image API error ${res.status}: ${text}`);
  }

  const json = (await res.json()) as {
    data: { b64_json?: string; url?: string }[];
  };
  const item = json.data[0];
  if (!item) throw new Error("Image API returned no data");

  if (item.b64_json) return item.b64_json;
  if (item.url) {
    const imgRes = await fetch(item.url);
    const buf = await imgRes.arrayBuffer();
    return Buffer.from(buf).toString("base64");
  }
  throw new Error("Image API returned neither b64_json nor url");
}
