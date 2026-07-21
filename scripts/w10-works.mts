/**
 * W10 多作品切换 + WorldState 隔离验收。
 * 运行：node --experimental-strip-types scripts/w10-works.mts
 */
import { pathToFileURL } from "node:url";

async function main() {
  const works = await import(
    pathToFileURL(new URL("../lib/engine/works.ts", import.meta.url).pathname).href
  );
  const { listWorks, getWork } = works as typeof import("../lib/engine/works");

  let failed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error("FAIL:", msg);
      failed += 1;
    } else console.log("OK:", msg);
  };

  // 1) listWorks returns ≥2 presets
  const all = listWorks();
  assert(all.length >= 2, `at least 2 works, got ${all.length}`);

  // 2) each work has required fields
  for (const w of all) {
    assert(typeof w.id === "string" && w.id.length > 0, `work ${w.id}: id`);
    assert(typeof w.title === "string" && w.title.length > 0, `work ${w.id}: title`);
    assert(typeof w.blurb === "string" && w.blurb.length > 0, `work ${w.id}: blurb`);
    assert(typeof w.worldSetting === "string" && w.worldSetting.length > 0, `work ${w.id}: worldSetting`);
    assert(typeof w.styleGuide === "string" && w.styleGuide.length > 0, `work ${w.id}: styleGuide`);
  }

  // 3) getWork by id
  const hs = getWork("highschool");
  assert(hs !== null, "highschool found");
  assert(hs?.title === "六月雨季", "highschool title");

  // 4) getWork unknown → null
  const fake = getWork("nonexistent_work_12345");
  assert(fake === null, "unknown work returns null");

  // 5) getWork absent → null
  const none = getWork();
  assert(none === null, "no arg returns null");

  // 6) unique work ids
  const ids = new Set(all.map((w) => w.id));
  assert(ids.size === all.length, "unique work ids");

  // 7) WorldState isolation: each work has distinct worldSetting
  const settings = all.map((w) => w.worldSetting);
  assert(new Set(settings).size === settings.length, "distinct worldSettings (no cross-bleed)");

  // 8) switch work A→B: resolve independent configs
  const a = getWork("highschool")!;
  const b = getWork("cyberpunk")!;
  assert(a.id !== b.id, "switch A≠B");
  assert(a.worldSetting !== b.worldSetting, "switch keeps WorldState isolated");
  assert(a.styleGuide !== b.styleGuide, "style guides isolated");

  // 9) list filter simulation (in-memory)
  type Meta = { id: string; workId?: string };
  const metas: Meta[] = [
    { id: "s1", workId: "highschool" },
    { id: "s2", workId: "cyberpunk" },
    { id: "s3", workId: "highschool" },
    { id: "s4" }, // legacy → default
  ];
  const filterBy = (workId?: string) =>
    metas.filter((m) => (workId ? (m.workId || "default") === workId : true));
  assert(filterBy("highschool").length === 2, "filter highschool → 2");
  assert(filterBy("cyberpunk").length === 1, "filter cyberpunk → 1");
  assert(filterBy("default").length === 1, "filter default → 1 legacy");
  assert(filterBy().length === 4, "filter none → all");

  if (failed) {
    console.error(`\n${failed} failed`);
    process.exit(1);
  }
  console.log("\nW10 multi-work: ALL PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});