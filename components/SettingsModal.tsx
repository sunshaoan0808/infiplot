"use client";

import { type ReactNode, useEffect, useState } from "react";

const PLAYER_NAME_STORAGE_KEY = "infiplot:playerName";
const VISION_CLICK_STORAGE_KEY = "infiplot:visionClick";

export function readStoredPlayerName(): string {
  try {
    return localStorage.getItem(PLAYER_NAME_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeStoredPlayerName(name: string): void {
  try {
    if (name) {
      localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
    } else {
      localStorage.removeItem(PLAYER_NAME_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function readStoredVisionClick(): boolean {
  try {
    return localStorage.getItem(VISION_CLICK_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function SettingsModal({
  initialVisionClickEnabled = true,
  onClose,
  onSaved,
  footerNote,
}: {
  initialVisionClickEnabled?: boolean;
  onClose: () => void;
  onSaved: (settings: { playerName: string; visionClickEnabled: boolean }) => void;
  footerNote?: ReactNode;
}) {
  const [playerName, setPlayerName] = useState(() => readStoredPlayerName());
  const [visionClick, setVisionClick] = useState(initialVisionClickEnabled);

  const [shown, setShown] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const close = () => {
    setShown(false);
    setTimeout(onClose, 280);
  };

  const save = () => {
    const name = playerName.trim();
    writeStoredPlayerName(name);

    try {
      localStorage.setItem(VISION_CLICK_STORAGE_KEY, visionClick ? "1" : "0");
    } catch { /* ignore */ }

    onSaved({ playerName: name, visionClickEnabled: visionClick });
    close();
  };

  const clearAll = () => {
    writeStoredPlayerName("");
    try { localStorage.removeItem(VISION_CLICK_STORAGE_KEY); } catch { /* ignore */ }
    onSaved({ playerName: "", visionClickEnabled: true });
    close();
  };

  const hasAnySetting = readStoredPlayerName().length > 0;

  return (
    <div
      onMouseDown={close}
      className={
        "fixed inset-0 z-[60] flex items-center justify-center p-6 md:p-10 transition-all duration-300 " +
        (shown
          ? "bg-clay-900/30 backdrop-blur-md"
          : "bg-clay-900/0 backdrop-blur-0")
      }
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className={
          "flex w-[560px] max-w-[94vw] max-h-[88vh] flex-col overflow-hidden rounded-sm border border-clay-900/15 bg-cream-50 shadow-2xl shadow-clay-900/25 transition-all duration-300 " +
          (shown ? "opacity-100 scale-100" : "opacity-0 scale-95")
        }
      >
        {/* Header */}
        <div className="flex items-center gap-5 px-6 md:px-8 py-5 border-b border-clay-900/10">
          <div className="flex flex-col">
            <span className="font-serif text-xl md:text-2xl text-clay-900">
              设置
            </span>
            <span className="text-[11px] text-clay-500 mt-1 tracking-wide">
              可选 · 这些设置仅保存在本地浏览器
            </span>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="关闭"
            className="ml-auto text-xl leading-none text-clay-500 hover:text-clay-900 transition-colors"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <div className="flex flex-col gap-0 overflow-y-auto">
          {/* ── Player Name Section ── */}
          <div className="flex flex-col gap-3 px-6 md:px-8 py-5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-sm border border-clay-900/10 bg-cream-100 text-clay-400">
                <i className="fa-solid fa-user-pen text-[11px]" />
              </span>
              <span className="font-serif text-base text-clay-900">
                玩家名字
              </span>
            </div>
            <input
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              type="text"
              maxLength={20}
              autoComplete="off"
              spellCheck={false}
              placeholder="不填则使用「你」"
              className="h-11 w-full rounded-sm border border-clay-900/15 bg-cream-100 px-4 font-sans text-sm text-clay-900 outline-none transition-colors focus:border-ember-500 placeholder:text-clay-400"
            />
            <span className="text-[11px] text-clay-400">
              NPC 会在对话中用这个名字称呼你。不填则默认以「你」称呼。
            </span>
          </div>

          <div className="border-t border-clay-900/8 mx-6 md:mx-8" />

          {/* ── Vision Click Section ── */}
          <div className="flex flex-col gap-3 px-6 md:px-8 py-5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-sm border border-clay-900/10 bg-cream-100 text-clay-400">
                <i className="fa-solid fa-eye text-[11px]" />
              </span>
              <span className="font-serif text-base text-clay-900">
                点击画面识别
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { on: true, label: "开启", icon: "fa-solid fa-wand-magic-sparkles" },
                  { on: false, label: "关闭", icon: "fa-solid fa-ban" },
                ] as const
              ).map((t) => {
                const active = visionClick === t.on;
                return (
                  <button
                    key={String(t.on)}
                    type="button"
                    onClick={() => setVisionClick(t.on)}
                    className={
                      "flex items-center justify-center gap-2 rounded-sm border px-3 py-2.5 text-[13px] transition-all " +
                      (active
                        ? "border-ember-500 bg-ember-500/5 text-clay-900"
                        : "border-clay-900/12 text-clay-600 hover:border-clay-900/35 hover:bg-cream-100")
                    }
                  >
                    <i className={t.icon + " text-[11px]"} />
                    {t.label}
                  </button>
                );
              })}
            </div>
            <span className="text-[11px] text-clay-400">
              开启后，在选择节点点击画面会触发 AI 识图并生成新的剧情分支。
            </span>
          </div>

          {footerNote && (
            <div className="px-6 md:px-8 pb-5">
              <p className="text-[11px] leading-relaxed text-clay-400">
                {footerNote}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-clay-900/10 px-6 md:px-8 py-4">
          {hasAnySetting && (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex items-center gap-2 rounded-sm border border-clay-900/15 px-4 py-2 font-sans text-sm text-clay-600 transition-colors hover:border-clay-900/35 hover:text-clay-900"
            >
              <i className="fa-solid fa-rotate-left text-xs" />
              全部清除
            </button>
          )}
          <button
            type="button"
            onClick={save}
            className="ml-auto inline-flex items-center gap-2 rounded-sm bg-clay-900 px-5 py-2.5 font-sans text-sm text-cream-50 transition-colors hover:bg-ember-500"
          >
            <i className="fa-solid fa-check text-xs" />
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
