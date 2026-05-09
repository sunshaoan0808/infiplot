import { generateImage } from "@dada/ai-client";
import type { ProviderConfig, StoryFrame } from "@dada/types";
import { buildImagePrompt } from "./prompts";

export async function render(
  config: ProviderConfig,
  frame: StoryFrame,
  styleGuide: string,
): Promise<string> {
  const prompt = buildImagePrompt(frame, styleGuide);
  return generateImage(config, prompt, { size: "1024x1536", quality: "medium" });
}
