import sharp from "sharp";

export async function annotateClick(
  imageBase64: string,
  click: { x: number; y: number },
): Promise<string> {
  const buf = Buffer.from(imageBase64, "base64");
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 1024;
  const h = meta.height ?? 1536;

  const cx = Math.round(click.x * w);
  const cy = Math.round(click.y * h);
  const r = Math.round(Math.min(w, h) * 0.025);
  const stroke = Math.max(3, Math.round(r * 0.25));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(255,40,40,0.55)"
            stroke="rgba(255,255,255,0.95)" stroke-width="${stroke}" />
    <circle cx="${cx}" cy="${cy}" r="${Math.round(r * 0.25)}"
            fill="rgba(255,255,255,1)" />
  </svg>`;

  const out = await sharp(buf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();

  return out.toString("base64");
}
