import { unpackDoc } from "@/lib/galleryCrypto";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 13_000_000;

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.GALLERY_SECRET;
  if (!secret) {
    return Response.json(
      { error: "剧情分享未启用 (GALLERY_SECRET 未配置)" },
      { status: 503 },
    );
  }

  const contentLength = req.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_FILE_BYTES) {
    return Response.json({ error: "文件太大" }, { status: 413 });
  }

  let ab: ArrayBuffer;
  try {
    ab = await req.arrayBuffer();
  } catch {
    return Response.json({ error: "Bad request body" }, { status: 400 });
  }
  if (ab.byteLength > MAX_FILE_BYTES) {
    return Response.json({ error: "文件太大" }, { status: 413 });
  }
  if (ab.byteLength === 0) {
    return Response.json({ error: "文件为空" }, { status: 400 });
  }

  try {
    const docStr = await unpackDoc(new Uint8Array(ab), secret);
    return Response.json({ docStr });
  } catch {
    return Response.json(
      { error: "剧情文件解包失败" },
      { status: 400 },
    );
  }
}
