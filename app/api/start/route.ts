import { startSession } from "@infiplot/engine";
import type { SceneStreamEvent, StartRequest } from "@infiplot/types";
import { NextResponse } from "next/server";
import { loadEngineConfig } from "@/lib/config";
import { requireUser } from "@/lib/supabase/guard";
import {
  checkComplianceGate,
  scanOutput,
  getAgeGate,
} from "@/lib/engine/compliance";

function formatSSE(event: SceneStreamEvent | { type: string; [k: string]: unknown }): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export const runtime = "nodejs";

const MAX_STYLE_REF_BYTES = 3 * 1024 * 1024;

function sceneText(result: { scene?: { beats?: Array<{ narration?: string; line?: string }> } }): string {
  const beats = result.scene?.beats ?? [];
  return beats.map((b) => [b.narration, b.line].filter(Boolean).join(" ")).join("\n");
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: StartRequest;
  try {
    body = (await req.json()) as StartRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.worldSetting?.trim() || !body.styleGuide?.trim()) {
    return NextResponse.json(
      { error: "worldSetting and styleGuide are required" },
      { status: 400 },
    );
  }

  // W6：开局设定输入扫描
  const compliance = checkComplianceGate(userId, body.worldSetting);
  if (compliance) {
    return NextResponse.json(
      { ...compliance, ageGate: getAgeGate(userId) },
      { status: 403 },
    );
  }

  if (typeof body.styleReferenceImage === "string") {
    if (!body.styleReferenceImage.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "styleReferenceImage must be a data:image/... base64 URL" },
        { status: 400 },
      );
    }
    if (body.styleReferenceImage.length > MAX_STYLE_REF_BYTES) {
      return NextResponse.json(
        { error: `styleReferenceImage exceeds ${MAX_STYLE_REF_BYTES} bytes` },
        { status: 413 },
      );
    }
  }

  const acceptsSSE = req.headers.get("accept")?.includes("text/event-stream");

  try {
    const base = loadEngineConfig();
    const config = body.clientTts === true ? { ...base, tts: undefined } : base;

    if (!acceptsSSE) {
      const result = await startSession(config, body);
      const outBlock = scanOutput(userId, sceneText(result));
      if (outBlock) {
        return NextResponse.json(
          { ...outBlock, ageGate: getAgeGate(userId) },
          { status: 403 },
        );
      }
      return NextResponse.json({ ...result, ageGate: getAgeGate(userId) });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const result = await startSession(config, body, (event) => {
            controller.enqueue(encoder.encode(formatSSE(event)));
          });
          const outBlock = scanOutput(userId, sceneText(result));
          if (outBlock) {
            controller.enqueue(
              encoder.encode(formatSSE({ type: "error", message: outBlock.message, ...outBlock })),
            );
            controller.close();
            return;
          }
          const { imageWait, ...responseBody } = result as typeof result & {
            imageWait?: Promise<void>;
          };
          controller.enqueue(
            encoder.encode(
              formatSSE({
                type: "done",
                response: { ...responseBody, ageGate: getAgeGate(userId) },
              }),
            ),
          );
          if (imageWait) {
            try {
              await imageWait;
            } catch {
              /* painter failed already emitted */
            }
          }
          controller.close();
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          controller.enqueue(
            encoder.encode(formatSSE({ type: "error", message })),
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
