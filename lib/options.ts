// Single source of truth for the home-page selector option sets. Kept as
// `as const` so each list also yields a literal-union type: the play-start
// UI (app/page.tsx) renders from the arrays, and the analytics schema
// (lib/analytics.ts) types its payload fields from the unions. That shared
// origin is what keeps the "content-free" events honest — an event field can
// only ever be one of these fixed labels, never free-form player text.

export const GENDERS = ["男性向", "女性向"] as const;

export const ART_STYLES = [
  "自动",
  "自定义风格",
  "京阿尼",
  "新海诚",
  "吉卜力",
  "3D 动画",
  "真实",
  "赛博朋克",
  "哥特",
  "废土",
  "像素风",
  "古典油画",
  "莫奈",
  "水彩",
  "水墨",
  "浮世绘",
  "彩铅",
  "手绘素描",
  "黑白漫画",
  "儿童绘本",
  "儿童涂鸦",
  "黏土手工",
] as const;

export const PLOT_STYLES = ["平铺直叙", "多线转折", "悬疑烧脑", "治愈日常"] as const;

export const PACINGS = ["慢热细腻", "紧凑爽快"] as const;

export type Gender = (typeof GENDERS)[number];
export type ArtStyle = (typeof ART_STYLES)[number];
export type PlotStyle = (typeof PLOT_STYLES)[number];
export type Pacing = (typeof PACINGS)[number];
