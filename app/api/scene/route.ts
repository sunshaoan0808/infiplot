import { requestScene } from "@infiplot/engine";
import type { Character, SceneRequest, SceneStreamEvent } from "@infiplot/types";
import { NextResponse } from "next/server";
import { loadEngineConfig } from "@/lib/config";
import { requireUser } from "@/lib/supabase/guard";
import {
  checkAdvance,
  chargeSuccess,
  getQuotaSnapshot,
} from "@/lib/engine/quota";
import {
  checkComplianceGate,
  scanOutput,
  getAgeGate,
} from "@/lib/engine/compliance";

function stripKnownVoices(
  characters: Character[],
  knownNames: Set<string>,
): Character[] {
  return characters.map((c) =>
    knownNames.has(c.name) ? { ...c, voice: undefined } : c,
  );
}

function formatSSE(event: SceneStreamEvent | { type: string; [k: string]: unknown }): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: SceneRequest;
  try {
    body = (await req.json()) as SceneRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.session) {
    return NextResponse.json({ error: "session is required" }, { status: 400 });
  }

  // W6：推进选择文本合规（freeform exit / choice label）
  const lastExit = body.session.history?.at(-1)?.exit;
  const advanceText =
    lastExit && "label" in lastExit
      ? String((lastExit as { label?: string }).label ?? "")
      : lastExit && "action" in lastExit
        ? String((lastExit as { action?: string }).action ?? "")
        : body.session.worldSetting ?? "";
  const compliance = checkComplianceGate(userId, advanceText);
  if (compliance) {
    return NextResponse.json(
      { ...compliance, ageGate: getAgeGate(userId), quota: getQuotaSnapshot(userId) },
      { status: 403 },
    );
  }

  // W5 软墙：配额不足挡推进，当前场由客户端保留
  const wall = checkAdvance(userId, "dialogue");
  if (wall) {
    return NextResponse.json(
      { ...wall, quota: getQuotaSnapshot(userId) },
      { status: 402 },
    );
  }

  const acceptsSSE = req.headers.get("accept")?.includes("text/event-stream");

  try {
    const base = loadEngineConfig();
    const config = body.clientTts === true ? { ...base, tts: undefined } : base;

    if (!acceptsSSE) {
      const result = await requestScene(config, body);
      const outText = (result.scene?.beats ?? [])
        .map((b) => [b.narration, b.line].filter(Boolean).join(" "))
        .join("\n");
      const outBlock = scanOutput(userId, outText);
      if (outBlock) {
        return NextResponse.json(
          { ...outBlock, ageGate: getAgeGate(userId), quota: getQuotaSnapshot(userId) },
          { status: 403 },
        );
      }
      chargeSuccess(userId, "dialogue");
      const knownNames = new Set(
        (body.session.characters ?? []).map((c) => c.name),
      );
      return NextResponse.json({
        ...result,
        characters: stripKnownVoices(result.characters, knownNames),
        quota: getQuotaSnapshot(userId),
        ageGate: getAgeGate(userId),
      });
    }

    const encoder = new TextEncoder();
    const knownNames = new Set(
      (body.session.characters ?? []).map((c) => c.name),
    );

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const result = await requestScene(config, body, (event) => {
            controller.enqueue(encoder.encode(formatSSE(event)));
          });
          const outText = (result.scene?.beats ?? [])
            .map((b) => [b.narration, b.line].filter(Boolean).join(" "))
            .join("\n");
          const outBlock = scanOutput(userId, outText);
          if (outBlock) {
            controller.enqueue(
              encoder.encode(
                formatSSE({ type: "error", message: outBlock.message, ...outBlock }),
              ),
            );
            controller.close();
            return;
          }
          chargeSuccess(userId, "dialogue");
          const { imageWait, ...responseBody } = result as typeof result & {
            imageWait?: Promise<void>;
          };
          controller.enqueue(
            encoder.encode(
              formatSSE({
                type: "done",
                response: {
                  ...responseBody,
                  characters: stripKnownVoices(result.characters, knownNames),
                  quota: getQuotaSnapshot(userId),
                  ageGate: getAgeGate(userId),
                },
              }),
            ),
          );
          // W2：等后台 Painter 把 image.* 发出去再关流
          if (imageWait) {
            try {
              await imageWait;
            } catch {
              /* painter already emitted image.failed */
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
