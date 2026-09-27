/** Card downloads: self-contained SVG, PNG (SVG → canvas) and PDF (jsPDF + svg2pdf, lazy-loaded). */

const FONT_CSS_URL = 'https://fonts.googleapis.com/css2?family=Exo+2:wght@400;700&display=swap';

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'card';
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const dataUrlCache = new Map<string, Promise<string>>();

/** Fetch a URL (artwork, font) as a data: URL, cached. */
export function fetchDataUrl(url: string): Promise<string> {
  let p = dataUrlCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        return res.blob();
      })
      .then(blobToDataUrl);
    p.catch(() => dataUrlCache.delete(url));
    dataUrlCache.set(url, p);
  }
  return p;
}

let fontCssPromise: Promise<string> | null = null;

/**
 * @font-face rules for Exo 2 (latin subsets) with the font files inlined, so
 * a downloaded SVG/PNG renders with the card font anywhere. Empty on failure.
 */
export function embeddedFontCss(): Promise<string> {
  fontCssPromise ??= (async () => {
    try {
      const css = await (await fetch(FONT_CSS_URL)).text();
      // Keep the latin blocks only: "/* latin */ @font-face {...}".
      const blocks = css.split(/(?=\/\*\s*[\w-]+\s*\*\/)/).filter((b) => /\/\*\s*latin(-ext)?\s*\*\//.test(b));
      const out: string[] = [];
      for (const block of blocks) {
        const m = /url\((https:[^)]+)\)/.exec(block);
        if (!m) continue;
        const data = await fetchDataUrl(m[1]);
        out.push(block.replace(m[1], data).replace(/\/\*[^*]*\*\//, '').trim());
      }
      return out.join('\n');
    } catch {
      fontCssPromise = null;
      return '';
    }
  })();
  return fontCssPromise;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not render the card image'));
    img.src = src;
  });
}

/** Draw a standalone SVG string onto a canvas at its natural size. */
export async function svgToCanvas(svg: string, width: number, height: number, scale = 1): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function svgToPngBlob(svg: string, width: number, height: number): Promise<Blob> {
  const canvas = await svgToCanvas(svg, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
  );
}

/** Re-encode an image (e.g. WebP artwork) as a JPEG data URL, which jsPDF can embed. */
export async function toJpegDataUrl(src: string, quality = 0.88): Promise<string> {
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL('image/jpeg', quality);
}

export interface PdfPage {
  /** SVG with a JPEG/PNG data-URL image and PDF-safe font (vector path). */
  svg: string;
  /** Standalone SVG for the raster fallback. */
  rasterSvg: () => Promise<string>;
  width: number;
  height: number;
}

/** A4 landscape/portrait pages, one card per page, card scaled to fit. */
export async function cardsToPdf(pages: PdfPage[]): Promise<Blob> {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const margin = 20;
  let doc: InstanceType<typeof jsPDF> | null = null;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:10px;height:10px;overflow:hidden';
  document.body.appendChild(host);
  try {
    for (const page of pages) {
      const orientation = page.width >= page.height ? 'landscape' : 'portrait';
      if (!doc) doc = new jsPDF({ orientation, unit: 'pt', format: 'a4', compress: true });
      else doc.addPage('a4', orientation);
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      const k = Math.min((pw - 2 * margin) / page.width, (ph - 2 * margin) / page.height);
      const w = page.width * k;
      const h = page.height * k;
      const x = (pw - w) / 2;
      const y = (ph - h) / 2;
      try {
        const el = new DOMParser().parseFromString(page.svg, 'image/svg+xml').documentElement;
        host.replaceChildren(document.importNode(el, true));
        await doc.svg(host.firstElementChild!, { x, y, width: w, height: h });
      } catch {
        // Vector conversion failed: embed a high-resolution raster of the card instead.
        const canvas = await svgToCanvas(await page.rasterSvg(), page.width, page.height);
        doc.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', x, y, w, h);
      }
    }
    if (!doc) throw new Error('No cards to export');
    return doc.output('blob');
  } finally {
    host.remove();
  }
}
