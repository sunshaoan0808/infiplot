"use client";

import { useRef } from "react";

export type Phase = "loading-first" | "ready" | "interacting";

export function PlayCanvas({
  imageBase64,
  phase,
  pendingClick,
  onClick,
}: {
  imageBase64: string | null;
  phase: Phase;
  pendingClick: { x: number; y: number } | null;
  onClick: (click: { x: number; y: number }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (phase !== "ready" || !ref.current || !imageBase64) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    onClick({
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    });
  }

  const interactive = phase === "ready" && !!imageBase64;
  const dimmed = phase === "interacting";

  return (
    <div className="w-full max-w-[440px] mx-auto">
      <div
        ref={ref}
        onClick={handleClick}
        className={`relative aspect-[2/3] w-full overflow-hidden bg-cream-200 select-none ${interactive ? "cursor-pointer" : "cursor-wait"}`}
        style={{
          boxShadow:
            "0 1px 0 rgba(45,24,16,0.05), 0 36px 64px -28px rgba(45,24,16,0.25), 0 8px 18px -6px rgba(45,24,16,0.10)",
        }}
      >
        {imageBase64 ? (
          <img
            key={imageBase64.slice(-48)}
            src={`data:image/png;base64,${imageBase64}`}
            alt="Generated frame"
            className={`absolute inset-0 w-full h-full object-cover animate-fade-in transition-opacity duration-700 ease-out ${dimmed ? "opacity-30" : "opacity-100"}`}
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <div className="w-1.5 h-1.5 bg-clay-500 rounded-full animate-slow-pulse" />
            <p className="text-[9px] smallcaps text-clay-500 animate-slow-pulse">
              Painting · the · first · frame
            </p>
          </div>
        )}

        <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-clay-900/15 to-transparent pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-clay-900/15 to-transparent pointer-events-none" />

        {pendingClick && (
          <>
            <div
              className="absolute rounded-full border border-ember-500 pointer-events-none"
              style={{
                left: `${pendingClick.x * 100}%`,
                top: `${pendingClick.y * 100}%`,
                transform: "translate(-50%, -50%)",
                width: 30,
                height: 30,
                animation:
                  "dada-ripple 1.6s cubic-bezier(0.16,1,0.3,1) infinite",
              }}
            />
            <div
              className="absolute rounded-full pointer-events-none"
              style={{
                left: `${pendingClick.x * 100}%`,
                top: `${pendingClick.y * 100}%`,
                transform: "translate(-50%, -50%)",
                width: 11,
                height: 11,
                background: "#D97A2E",
                boxShadow:
                  "0 0 0 3px rgba(251,247,240,0.95), 0 0 14px rgba(217,122,46,0.55)",
              }}
            />
          </>
        )}
      </div>

      <div className="flex items-center justify-between mt-3 px-1">
        <span className="text-[9px] smallcaps text-clay-400 num">
          1024 × 1536 · png
        </span>
        <span className="text-[9px] smallcaps text-clay-400">
          {phase === "ready" ? "Tap · anywhere" : "···"}
        </span>
      </div>
    </div>
  );
}
