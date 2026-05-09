import type { ProviderConfig } from "@dada/types";

export async function interpretClick(
  config: ProviderConfig,
  imageBase64: string,
  prompt: string,
): Promise<string> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const body = {
    model: config.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${imageBase64}` },
          },
        ],
      },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
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
    throw new Error(`Vision API error ${res.status}: ${text}`);
  }

  const json = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  return json.choices[0]?.message.content ?? "";
}
