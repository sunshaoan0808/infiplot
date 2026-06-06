import { generateText } from "ai";
import type { ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { ProviderConfig, ProviderProtocol } from "@infiplot/types";
import { normalizeBaseUrl } from "./normalizeUrl";

const VISION_TIMEOUT_MS = 60_000;

export async function interpretClick(
  config: ProviderConfig,
  imageBase64: string,
  prompt: string,
): Promise<string> {
  return analyzeImageDataUrl(
    config,
    `data:image/png;base64,${imageBase64}`,
    prompt,
  );
}

function resolveVisionProtocol(config: ProviderConfig): ProviderProtocol {
  return config.provider ?? "openai_compatible";
}

export async function analyzeImageDataUrl(
  config: ProviderConfig,
  imageDataUrl: string,
  prompt: string,
): Promise<string> {
  const protocol = resolveVisionProtocol(config);
  const baseURL = normalizeBaseUrl(config.baseUrl, protocol);

  let model;
  switch (protocol) {
    case "anthropic":
      model = createAnthropic({ apiKey: config.apiKey, baseURL })(config.model);
      break;
    case "google":
      model = createGoogleGenerativeAI({ apiKey: config.apiKey, baseURL })(config.model);
      break;
    case "openai_compatible":
    case "openai":
    default:
      model = createOpenAI({ apiKey: config.apiKey, baseURL }).chat(config.model);
      break;
  }

  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image", image: imageDataUrl },
      ],
    },
  ];

  const timeoutCtrl = new AbortController();
  const timeoutId = setTimeout(() => timeoutCtrl.abort(), VISION_TIMEOUT_MS);
  try {
    const { text } = await generateText({
      model,
      messages,
      temperature: 0.2,
      maxRetries: 0,
      abortSignal: timeoutCtrl.signal,
    });
    if (typeof text !== "string" || text.length === 0) {
      throw new Error(`Vision API (AI SDK ${protocol}) returned no content.`);
    }
    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}
