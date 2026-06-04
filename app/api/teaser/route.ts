import { chat } from "@infiplot/ai-client";
import { NextResponse } from "next/server";
import { loadEngineConfig } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 30;

const TEASER_SYSTEM = `你是一个交互视觉小说的“故事预告设计师/旁白配音员”。
根据用户输入的故事设定、面向观众、剧情风格和内容节奏，为该故事撰写一段富有悬念、画面感极强、极具吸引力的【故事预告】（类似电影预告片旁白风格）。

要求：
1. 语言必须富有情感、张力、史诗感或治愈感（根据题材基调决定），用第二人称“你”指代玩家。
2. 长度控制在 80-150 字以内，字句简练，用字考究，多用短句。
3. 绝对只返回预告片纯文本内容，不要带有任何 JSON 标记、Markdown 标题或“预告：”等任何额外字符。直接输出文字本身。`;

export async function POST(req: Request) {
  let body: { worldSetting?: string };
  try {
    body = (await req.json()) as { worldSetting?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const worldSetting = body.worldSetting?.trim();
  if (!worldSetting) {
    return NextResponse.json({ error: "worldSetting is required" }, { status: 400 });
  }

  try {
    const config = loadEngineConfig(req.headers);
    const rawTeaser = await chat(
      config.text,
      [
        { role: "system", content: TEASER_SYSTEM },
        { role: "user", content: `故事设定如下，请生成一段精彩的预告：\n\n${worldSetting}` },
      ],
      { temperature: 0.85, tag: "teaser" }
    );

    return NextResponse.json({ teaser: rawTeaser.trim() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
