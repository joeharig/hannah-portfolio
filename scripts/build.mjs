// Build step for Netlify: copies the static site into _site/ and pre-renders
// each portfolio PDF into WebP page images so the flipbooks load images
// instead of downloading and parsing whole PDFs in the browser.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "_site");

const BOOKS = ["graphic-design-portfolio"];
const PAGE_LONG_EDGE = 2048; // matches the flipbook's pageTextureSize
const THUMB_LONG_EDGE = 300;
const PAGE_QUALITY = 82;
const THUMB_QUALITY = 75;

const STATIC = ["index.html", "site.webmanifest", "Halimun.woff", "css", "js", "images", "pdf"];

class CanvasFactory {
  create(w, h) {
    const canvas = createCanvas(w, h);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(cc, w, h) {
    cc.canvas.width = w;
    cc.canvas.height = h;
  }
  destroy(cc) {
    cc.canvas.width = 0;
    cc.canvas.height = 0;
  }
}

async function renderBook(name) {
  const data = new Uint8Array(await fs.readFile(path.join(root, "pdf", `${name}.pdf`)));
  const pdfjsDir = path.dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")));
  const doc = await pdfjs.getDocument({
    data,
    canvasFactory: new CanvasFactory(),
    standardFontDataUrl: path.join(pdfjsDir, "standard_fonts") + "/",
    cMapUrl: path.join(pdfjsDir, "cmaps") + "/",
    cMapPacked: true,
    isEvalSupported: false,
    disableFontFace: true, // draw glyphs as paths (node canvas has no @font-face)
    useSystemFonts: false,
  }).promise;

  const dir = path.join(out, "pages", name);
  await fs.mkdir(path.join(dir, "thumbs"), { recursive: true });
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = PAGE_LONG_EDGE / Math.max(base.width, base.height);
    const vp = page.getViewport({ scale });
    const w = Math.round(vp.width), h = Math.round(vp.height);
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const num = String(i).padStart(2, "0");
    await fs.writeFile(path.join(dir, `${num}.webp`), await canvas.encode("webp", PAGE_QUALITY));

    const ts = THUMB_LONG_EDGE / Math.max(w, h);
    const tw = Math.round(w * ts), th = Math.round(h * ts);
    const thumb = createCanvas(tw, th);
    thumb.getContext("2d").drawImage(canvas, 0, 0, tw, th);
    await fs.writeFile(path.join(dir, "thumbs", `${num}.webp`), await thumb.encode("webp", THUMB_QUALITY));
    pages.push({ src: `pages/${name}/${num}.webp`, thumb: `pages/${name}/thumbs/${num}.webp` });
    page.cleanup();
  }
  await doc.destroy();
  console.log(`${name}: ${pages.length} pages`);
  return pages;
}

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
for (const item of STATIC) {
  await fs.cp(path.join(root, item), path.join(out, item), { recursive: true });
}
const manifest = {};
for (const name of BOOKS) manifest[name] = await renderBook(name);
await fs.writeFile(
  path.join(out, "js", "books.js"),
  `window.FLIPBOOK_PAGES = ${JSON.stringify(manifest)};\n`
);
console.log("Built _site/");
