"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { PlayCanvas, type Phase } from "@/components/PlayCanvas";
import { PRESETS } from "@/lib/presets";
import type {
  ClickIntent,
  InteractResponse,
  Session,
  StartResponse,
  StoryFrame,
} from "@dada/types";

function PlayInner() {
  const router = useRouter();
  const params = useSearchParams();

  const [phase, setPhase] = useState<Phase>("loading-first");
  const [session, setSession] = useState<Session | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [frame, setFrame] = useState<StoryFrame | null>(null);
  const [intent, setIntent] = useState<ClickIntent | null>(null);
  const [pendingClick, setPendingClick] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [turnNum, setTurnNum] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let payload: { worldSetting: string; styleGuide: string } | null = null;
    const presetId = params.get("preset");

    if (presetId) {
      const p = PRESETS.find((x) => x.id === presetId);
      if (p) {
        payload = { worldSetting: p.worldSetting, styleGuide: p.styleGuide };
      }
    } else if (params.get("custom") === "1") {
      const stored = sessionStorage.getItem("dada:custom");
      if (stored) {
        try {
          payload = JSON.parse(stored);
        } catch {
          payload = null;
        }
      }
    }

    if (!payload) {
      router.replace("/");
      return;
    }

    const finalPayload = payload;

    fetch("/api/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(finalPayload),
    })
      .then(async (r) => {
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? r.statusText);
        }
        return r.json() as Promise<StartResponse>;
      })
      .then((data) => {
        setSession({
          id: data.sessionId,
          createdAt: Date.now(),
          worldSetting: finalPayload.worldSetting,
          styleGuide: finalPayload.styleGuide,
          history: [{ frame: data.frame }],
        });
        setFrame(data.frame);
        setImageBase64(data.imageBase64);
        setPhase("ready");
        setTurnNum(1);
      })
      .catch((e) => setError(String(e)));
  }, [params, router]);

  async function handleClick(click: { x: number; y: number }) {
    if (phase !== "ready" || !session || !imageBase64) return;
    setPhase("interacting");
    setPendingClick(click);
    setIntent(null);

    try {
      const res = await fetch("/api/interact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session,
          prevImageBase64: imageBase64,
          click,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? res.statusText);
      }
      const data = (await res.json()) as InteractResponse;

      const updatedHistory = [
        ...data.session.history,
        { frame: data.frame },
      ];
      setSession({ ...data.session, history: updatedHistory });
      setFrame(data.frame);
      setImageBase64(data.imageBase64);
      setIntent(data.intent);
      setPendingClick(null);
      setTurnNum((t) => t + 1);
      setPhase("ready");
    } catch (e) {
      setError(String(e));
      setPendingClick(null);
      setPhase("ready");
    }
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8">
        <div className="max-w-md text-center animate-fade-in">
          <p className="text-[10px] smallcaps text-clay-500 mb-6">
            An · error · occurred
          </p>
          <p className="font-serif italic text-clay-900 text-lg leading-[1.7] mb-10">
            {error}
          </p>
          <Link
            href="/"
            className="text-[10px] smallcaps text-clay-700 hover:text-ember-500 transition-colors inline-flex items-center gap-3"
          >
            <i className="fa-solid fa-arrow-left text-[9px]" />
            Return
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-5 md:px-12 pt-6 md:pt-8 flex items-center justify-between">
        <Link
          href="/"
          className="text-[10px] smallcaps text-clay-600 hover:text-clay-900 transition-colors flex items-center gap-2"
        >
          <i className="fa-solid fa-arrow-left text-[9px]" />
          Dada
        </Link>
        <div className="flex items-center gap-3 text-[10px] smallcaps text-clay-500 num">
          <span>Frame · {String(turnNum).padStart(3, "0")}</span>
          <span className="text-clay-300">·</span>
          <span className="hidden sm:inline truncate max-w-[180px]">
            {session?.id.slice(2, 14) ?? "—"}
          </span>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 md:px-8 py-6 md:py-10">
        <PlayCanvas
          imageBase64={imageBase64}
          phase={phase}
          pendingClick={pendingClick}
          onClick={handleClick}
        />

        <div className="mt-7 md:mt-9 max-w-md w-full text-center min-h-[64px] flex items-center justify-center">
          {phase === "loading-first" && (
            <p className="text-[10px] smallcaps text-clay-500 animate-slow-pulse">
              Summoning · the · first · frame
            </p>
          )}
          {phase === "interacting" && (
            <div className="flex flex-col items-center gap-2 animate-fade-in">
              <p className="text-[10px] smallcaps text-clay-500 animate-slow-pulse">
                AI · is · painting · the · next · moment
              </p>
              <p className="font-serif italic text-clay-400 text-xs">
                this usually takes 12–20 seconds
              </p>
            </div>
          )}
          {phase === "ready" && intent?.targetLabel && (
            <p className="font-serif italic text-clay-500 text-base leading-relaxed animate-fade-in max-w-[320px]">
              <span className="text-[9px] smallcaps not-italic text-clay-400 mr-2 align-middle">
                Last · move ·
              </span>
              <span className="align-middle">{intent.targetLabel}</span>
            </p>
          )}
          {phase === "ready" && !intent && turnNum > 0 && (
            <p className="text-[10px] smallcaps text-clay-400 animate-fade-in">
              Click · anywhere · to · respond
            </p>
          )}
        </div>
      </main>

      <footer className="px-5 md:px-12 pb-6">
        <div className="text-[9px] smallcaps text-clay-400 text-center num">
          Ⅰ · Ⅰ
        </div>
      </footer>
    </div>
  );
}

export default function PlayPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <span className="text-[10px] smallcaps text-clay-500 animate-slow-pulse">
            Loading
          </span>
        </div>
      }
    >
      <PlayInner />
    </Suspense>
  );
}
