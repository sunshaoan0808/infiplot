import type { Scene, Session } from "@yume/types";

// ──────────────────────────────────────────────────────────────────────
//  Director — emits one Scene (background + a graph of beats) at a time.
// ──────────────────────────────────────────────────────────────────────

export const DIRECTOR_SYSTEM = `你是一个交互视觉小说的「场景导演」。每次基于世界观、画风、玩家历史、已登记角色，输出**一个完整的场景**，并为每句台词配上细腻的配音导演指令。

一个场景包含：
- 一张背景图（你给出英文 scenePrompt）
- 一组对话节拍 beats，玩家会按顺序经历它们
- 任何**首次登场**的角色，需在 characterUpdates 里登记其专属音色设计

每个 beat 是玩家会看到的一段叙述 / 对话 / 选择。beat 之间通过 next 字段连接：
- "continue": 玩家点击图片背景 / 按继续，自然推进到下一个 beat
- "choice": 在此让玩家做选择，按所选 choice 的 effect 走向

choice 的 effect 有两种：
- "advance-beat": 玩家选了之后跳到**同场景内**的另一个 beat（不换背景图，速度极快）
- "change-scene": 玩家选了之后切换到**新场景**（视角变了 / 走到新地方 / 时间跳了）

设计原则：
- 同场景内 beat 数自由发挥，按剧情节奏自然给出（通常 2–6 个，可以更多）
- 多用 continue，少用 choice — 选择只应出现在「真正的岔路口」
- advance-beat 适合处理对话分支（同一场景里换个话题、追问、撒娇）
- change-scene 适合空间/时间跳跃（出门、转身看窗外、第二天清晨）
- 一个场景至少要有一个 change-scene 出口（除非真到结局）
- 每个 change-scene 必须带 nextSceneSeed —— 一句中文简述「下一场是哪里、谁在、要发生什么」，用来引导下一次导演调用
- 同一场景的 beat id 互不重复
- next.nextBeatId 引用的 beat 必须存在
- choice 至少 2 个，至多 4 个，互不重复

文本风格约束：
- narration / line 用中文（**纯净可显示文本**，绝不要写 (叹气)(语速快) 这类标注 —— 那是给配音的，会被玩家看见）
- scenePrompt / lineDelivery / characterUpdates 内的文字按下方专门说明
- 单个 beat 的 narration 与 line 加起来 ≤80 字
- 单个 choice label ≤15 字
- scenePrompt 用英文，只描述画面里看到什么，不要描述 UI

配音相关字段：
- 每个有 line 的 beat **必须**给出 lineDelivery —— 自由中文的"配音导演指令"，描述该句台词怎么念（情绪 / 语气 / 语速 / 气息 / 停顿 / 重音 / 音色起伏）。例："鼓起勇气又害羞，声音发颤、偏小，句尾带一丝气声，语速偏慢"。平淡场合写"平静自然、语速适中"即可，但要贴当下情境。
- characterUpdates 仅当**有新角色首次出现**时列出该新角色的音色设计；已登记的角色不要重复列出。
- characterUpdates[].description **必须以明确性别开头**（"女性，…" / "男性，…"），随后描述：年龄、音色质感、性格情绪基调、语速节奏、人设腔调、口音方言。例："女性，约17岁少女，音色清亮带点稚嫩甜美，性格开朗，语速偏快，标准普通话"。

角色与台词的硬性规则（影响配音正确性）：
- 任何 beat 的 speaker 字段一旦填了名字，**该名字必须**：① 在"已登记角色"列表中存在，或 ② 本次输出的 characterUpdates 里登记。绝不允许 speaker 是个未登记的陌生名字。
- speaker 名字必须与登记名**完全一致**，不要加「（回忆）」「学姐」之类后缀或别名。

必须输出严格 JSON，结构如下：
{
  "scenePrompt": "english scene description, no UI",
  "entryBeatId": "b1",
  "characterUpdates": [
    { "name": "夏海", "description": "女性，约17岁少女，音色清亮带点稚嫩甜美…" }
  ],
  "beats": [
    {
      "id": "b1",
      "narration": "可空（纯净文本）",
      "speaker": "可空",
      "line": "可空（纯净文本）",
      "lineDelivery": "line 非空时必填：配音导演指令",
      "next": { "type": "continue", "nextBeatId": "b2" }
    },
    {
      "id": "b2",
      "speaker": "夏海",
      "line": "学长，我有话想对你说。",
      "lineDelivery": "鼓起勇气，但又有点害羞，语速偏慢，句尾微微上扬",
      "next": {
        "type": "choice",
        "choices": [
          {
            "id": "c1",
            "label": "继续追问",
            "effect": { "kind": "advance-beat", "targetBeatId": "b3" }
          },
          {
            "id": "c2",
            "label": "起身离开教室",
            "effect": { "kind": "change-scene", "nextSceneSeed": "雨后湿漉漉的走廊，她追了出来" }
          }
        ]
      }
    }
  ]
}

不要输出 JSON 以外的任何文本。`;

export function buildDirectorUserMessage(session: Session): string {
  const parts: string[] = [];
  parts.push(`世界观：${session.worldSetting}`);
  parts.push(`画风：${session.styleGuide}`);

  if (session.characters.length > 0) {
    parts.push("\n已登记角色（speaker 必须用这些名字之一，或在本次 characterUpdates 里登记新名）：");
    for (const c of session.characters) {
      parts.push(`- ${c.name}：${c.description}`);
    }
  }

  if (session.history.length === 0) {
    parts.push("\n这是故事的开场。请生成第一个场景，严格以 JSON 格式返回。");
    return parts.join("\n");
  }

  parts.push("\n场景历史（按时间顺序）：");
  session.history.forEach((entry, idx) => {
    const lines: string[] = [`【场景 ${idx + 1}】`];
    lines.push(`  scenePrompt: ${entry.scene.scenePrompt}`);

    const visited = entry.visitedBeatIds.length
      ? entry.visitedBeatIds
      : [entry.scene.entryBeatId];
    const beatById = new Map(entry.scene.beats.map((b) => [b.id, b]));
    const visitedBeats = visited
      .map((id) => beatById.get(id))
      .filter((b): b is NonNullable<typeof b> => Boolean(b));

    for (const b of visitedBeats) {
      const fragments: string[] = [];
      if (b.narration) fragments.push(`旁白：${b.narration}`);
      if (b.line) fragments.push(`${b.speaker ?? "?"}：${b.line}`);
      if (fragments.length) lines.push("  " + fragments.join(" / "));
    }

    if (entry.exit) {
      if (entry.exit.kind === "choice") {
        lines.push(
          `  玩家最终选择：${entry.exit.label}（去往：${entry.exit.nextSceneSeed}）`,
        );
      } else {
        lines.push(`  玩家自由动作：${entry.exit.action}`);
      }
    }
    parts.push(lines.join("\n"));
  });

  const last = session.history.at(-1);
  const lastExit = last?.exit;
  if (lastExit) {
    if (lastExit.kind === "choice") {
      parts.push(
        `\n请基于「玩家在上一场选择了：${lastExit.label}」，生成下一个场景（参考种子：${lastExit.nextSceneSeed}）。`,
      );
    } else {
      parts.push(
        `\n请基于「玩家自由动作：${lastExit.action}」，生成下一个场景。`,
      );
    }
  } else {
    parts.push("\n请生成下一个场景。");
  }

  parts.push("严格以 JSON 格式返回。");
  return parts.join("\n");
}

// ──────────────────────────────────────────────────────────────────────
//  Insert-Beat — given a freeform vision action that is judged to stay
//  *within* the current scene, generate one transient beat.
// ──────────────────────────────────────────────────────────────────────

export const INSERT_BEAT_SYSTEM = `你是视觉小说编剧。玩家在当前场景内做了一个**不会换场景的自由动作**（比如看一眼桌上的相框、想了想刚才那句话）。请基于此动作，写出一个**单独的、过渡性的 beat**：可以是旁白、角色台词、或两者结合。

文本风格约束：
- narration / line 用中文，**纯净可显示文本**，不要写 (叹气) 这类配音标注
- narration 与 line 加起来 ≤80 字
- 不要打破当前场景的物理状态（玩家仍在原地、对面仍是同一个角色）
- 不要生成选项或下一步指引 —— 玩家点击会自然回到原 beat
- 如果有 line，speaker 必须用**已登记角色**里的名字（绝不允许引入新角色）
- 如果有 line，**必须**给出 lineDelivery（配音导演指令，自由中文，描述这句话怎么念）

必须输出严格 JSON：
{
  "narration": "...",
  "speaker": "...",
  "line": "...",
  "lineDelivery": "..."
}

narration/speaker/line/lineDelivery 都可为空字符串。不要输出 JSON 以外的任何文本。`;

export function buildInsertBeatUserMessage(
  session: Session,
  freeformAction: string,
): string {
  const parts: string[] = [];
  parts.push(`世界观：${session.worldSetting}`);

  if (session.characters.length > 0) {
    parts.push("\n已登记角色（speaker 只能用这些名字）：");
    for (const c of session.characters) {
      parts.push(`- ${c.name}`);
    }
  }

  const current = session.history.at(-1);
  if (current) {
    parts.push(`\n当前场景：${current.scene.scenePrompt}`);
    const lastBeatId = current.visitedBeatIds.at(-1) ?? current.scene.entryBeatId;
    const lastBeat = current.scene.beats.find((b) => b.id === lastBeatId);
    if (lastBeat) {
      const recent: string[] = [];
      if (lastBeat.narration) recent.push(`旁白：${lastBeat.narration}`);
      if (lastBeat.line) recent.push(`${lastBeat.speaker ?? "?"}：${lastBeat.line}`);
      if (recent.length) parts.push(`刚才发生：${recent.join(" / ")}`);
    }
  }

  parts.push(`\n玩家此刻的自由动作：${freeformAction}`);
  parts.push("\n请生成一个过渡性 beat，严格以 JSON 格式返回。");
  return parts.join("\n");
}

// ──────────────────────────────────────────────────────────────────────
//  Image renderer
// ──────────────────────────────────────────────────────────────────────

export function buildImagePrompt(scene: Scene, styleGuide: string): string {
  return `Generate a cinematic landscape background illustration, 16:9 widescreen (1792x1024).

ART STYLE: ${styleGuide}

SCENE (fill the ENTIRE canvas — no UI elements, no text overlays):
${scene.scenePrompt}

STRICT RULES — NEVER violate these:
- DO NOT draw any dialogue boxes, speech bubbles, text panels, or any rectangular overlay.
- DO NOT draw any buttons, choice options, menu items, or interactive UI elements.
- DO NOT render any Chinese or English text anywhere in the image.
- DO NOT add any HUD, interface chrome, or game UI elements.
- The image is a PURE BACKGROUND SCENE ONLY. All UI will be added as HTML on top.
- 16:9 LANDSCAPE orientation — wider than tall. No portrait or square output.
- Leave the bottom 35% of the frame relatively uncluttered (darker or softer) so overlaid UI panels remain readable.
- Characters or key scene elements should be positioned in the upper 65% of the frame.`;
}

// ──────────────────────────────────────────────────────────────────────
//  Vision — interprets a background click and classifies the action.
// ──────────────────────────────────────────────────────────────────────

export const VISION_SYSTEM_PROMPT = `你是视觉理解助手。玩家在视觉小说的背景图上点击了红色圆点位置（HTML 上的选项按钮不会走到你这里）。你的任务是：
1. 看清红点指向画面里的什么（物件、角色、空间、远处的方向）
2. 推断玩家想干什么
3. 判断这个动作是「场内探索」（不该换图）还是「场景切换」（要换图）

判断准则：
- "insert-beat"（场内探索）：观察画面里某个细节、自言自语、和当前角色继续互动、看一眼某个物件
- "change-scene"（场景切换）：走向画面深处的门 / 走廊、转头看向新方向（视角变了）、点了远处的另一个空间、暗示时间跳跃的物件（如时钟）

必须输出严格 JSON：
{
  "freeformAction": "玩家想做什么的一句中文描述，例如「想拿起桌上的钥匙」",
  "classify": "insert-beat" 或 "change-scene",
  "reasoning": "一句话说明判断理由"
}

不要输出 JSON 以外的任何文本。`;

export function buildVisionUserPrompt(scene: Scene | null): string {
  if (!scene) return "请判断玩家意图，并以 JSON 格式返回。";
  return `当前场景描述：${scene.scenePrompt}

红点位置即为玩家点击位置。请判断玩家意图与分类，以 JSON 格式返回。`;
}
