/**
 * In-memory image job ledger for W2 poll fallback.
 * Keyed by sceneId (Fusion/Infi scene id). Process-local only —
 * enough for single-node Infi; multi-instance needs shared store later.
 */

export type ImageJobStatus = "pending" | "ready" | "failed" | "empty";

export type ImageJob = {
  sceneId: string;
  sessionId?: string;
  status: ImageJobStatus;
  imageUrl?: string;
  imageUuid?: string;
  sceneKey?: string;
  error?: string;
  updatedAt: number;
};

const jobs = new Map<string, ImageJob>();

const MAX_JOBS = 500;

function trim() {
  if (jobs.size <= MAX_JOBS) return;
  const sorted = [...jobs.entries()].sort(
    (a, b) => a[1].updatedAt - b[1].updatedAt,
  );
  for (const [k] of sorted.slice(0, jobs.size - MAX_JOBS)) jobs.delete(k);
}

export function upsertImageJob(
  sceneId: string,
  patch: Partial<Omit<ImageJob, "sceneId" | "updatedAt">> & {
    status: ImageJobStatus;
  },
): ImageJob {
  const prev = jobs.get(sceneId);
  const next: ImageJob = {
    sceneId,
    sessionId: patch.sessionId ?? prev?.sessionId,
    status: patch.status,
    imageUrl: patch.imageUrl ?? prev?.imageUrl,
    imageUuid: patch.imageUuid ?? prev?.imageUuid,
    sceneKey: patch.sceneKey ?? prev?.sceneKey,
    error: patch.error ?? (patch.status === "ready" ? undefined : prev?.error),
    updatedAt: Date.now(),
  };
  jobs.set(sceneId, next);
  trim();
  return next;
}

export function getImageJob(sceneId: string): ImageJob | undefined {
  return jobs.get(sceneId);
}

export function getImageJobBySessionScene(
  sessionId: string,
  sceneId: string,
): ImageJob | undefined {
  const j = jobs.get(sceneId);
  if (!j) return undefined;
  if (j.sessionId && j.sessionId !== sessionId) return undefined;
  return j;
}
