/** Image loading and re-encoding for the layout editor (browser canvas). */
import { Box, ImagePoint } from '../../../core/data/catalog.types';
import { MAX_IMAGE_SIDE } from '../../../core/devices/device-files';
import { BorderColour, CanvasBackground, NO_PADDING, Padding, detectBackground, outputScale, paddedSize } from './canvas-padding';
import { DraftImage, ImageType, newUid } from './draft';

export const ACCEPTED_IMAGES = 'image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg';

export function isSvg(file: Blob & { name?: string }): boolean {
  return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name ?? '');
}

export function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The image could not be read'));
    img.src = src;
  });
}

/** Size of an SVG from its width/height attributes or viewBox. */
function svgSize(text: string): { width: number; height: number } | null {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') return null;
  const num = (v: string | null) => (v && /^[\d.]+(px)?$/.test(v.trim()) ? parseFloat(v) : NaN);
  let w = num(svg.getAttribute('width'));
  let h = num(svg.getAttribute('height'));
  const vb = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if ((!(w > 0) || !(h > 0)) && vb?.length === 4 && vb[2] > 0 && vb[3] > 0) {
    w = vb[2];
    h = vb[3];
  }
  return w > 0 && h > 0 ? { width: Math.round(w), height: Math.round(h) } : null;
}

export async function canvasToBlob(canvas: HTMLCanvasElement): Promise<{ blob: Blob; type: ImageType }> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.85));
  if (blob && blob.type === 'image/webp') return { blob, type: 'webp' };
  // Browsers without WebP encoding (Safari) fall back to PNG.
  const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!png) throw new Error('Could not encode the image');
  return { blob: png, type: 'png' };
}

/**
 * Read an uploaded image. SVGs are kept as they are; other formats are
 * re-encoded to WebP with the longest side at most MAX_IMAGE_SIDE.
 */
export async function loadImageFile(file: Blob & { name?: string }): Promise<DraftImage> {
  const name = file.name ?? 'image';
  if (isSvg(file)) {
    const text = await file.text();
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    try {
      let size = svgSize(text);
      if (!size) {
        const img = await loadHtmlImage(url);
        size = { width: img.naturalWidth, height: img.naturalHeight };
      }
      if (!size.width || !size.height) throw new Error('The SVG has no size (add width/height or a viewBox)');
      return { uid: newUid(), name, blob: new Blob([text], { type: 'image/svg+xml' }), type: 'svg', width: size.width, height: size.height };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) && !/\.(png|jpe?g|webp)$/i.test(name)) {
    throw new Error(`${name}: use a PNG, JPG, WebP or SVG image`);
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadHtmlImage(url);
    const { naturalWidth: w, naturalHeight: h } = img;
    if (!w || !h) throw new Error(`${name}: the image is empty`);
    if (file.type === 'image/webp' && Math.max(w, h) <= MAX_IMAGE_SIDE) {
      return { uid: newUid(), name, blob: file, type: 'webp', width: w, height: h };
    }
    const s = Math.min(1, MAX_IMAGE_SIDE / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * s);
    canvas.height = Math.round(h * s);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = await canvasToBlob(canvas);
    return { uid: newUid(), name, blob: out.blob, type: out.type, width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface Adjustment {
  /** Quarter turns clockwise, in degrees. */
  rotate: 0 | 90 | 180 | 270;
  /** Fine straightening, −10..10 degrees. */
  straighten: number;
  /** Crop in rotated-image pixels, or null for everything. */
  crop: Box | null;
  /** Space added around the cropped image, in its pixels (before scaling). */
  pad?: Padding | null;
  /** Fill behind the image (added space, rotated corners). Default: transparent. */
  background?: CanvasBackground | null;
  /** Scale the result to this width (up or down); the longest side stays ≤ MAX_IMAGE_SIDE. */
  outputWidth?: number | null;
}

/** Size of the image after rotation (bounding box). */
export function rotatedSize(w: number, h: number, degrees: number): { width: number; height: number } {
  const a = (degrees * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  return { width: Math.round(w * c + h * s), height: Math.round(w * s + h * c) };
}

interface Geometry {
  deg: number;
  rot: { width: number; height: number };
  crop: Box;
  pad: Padding;
  scale: number;
  width: number;
  height: number;
}

function geometry(w: number, h: number, adj: Adjustment, maxSide = MAX_IMAGE_SIDE): Geometry {
  const deg = adj.rotate + adj.straighten;
  const rot = rotatedSize(w, h, deg);
  const crop = adj.crop ?? { x: 0, y: 0, w: rot.width, h: rot.height };
  const pad = adj.pad ?? NO_PADDING;
  const size = paddedSize(crop.w, crop.h, pad);
  const scale = outputScale(size.width, size.height, adj.outputWidth, maxSide);
  return {
    deg,
    rot,
    crop,
    pad,
    scale,
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/** Output size of an adjustment. */
export function adjustedSize(w: number, h: number, adj: Adjustment): { width: number; height: number } {
  const g = geometry(w, h, adj);
  return { width: g.width, height: g.height };
}

/** Maps a point of the original image to the adjusted one. */
export function adjustmentTransform(w: number, h: number, adj: Adjustment): { scale: number; width: number; height: number; map: (x: number, y: number) => { x: number; y: number } } {
  const g = geometry(w, h, adj);
  const a = (g.deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return {
    scale: g.scale,
    width: g.width,
    height: g.height,
    map: (x, y) => {
      const dx = x - w / 2;
      const dy = y - h / 2;
      const rx = dx * cos - dy * sin + g.rot.width / 2;
      const ry = dx * sin + dy * cos + g.rot.height / 2;
      return { x: (rx - g.crop.x + g.pad.left) * g.scale, y: (ry - g.crop.y + g.pad.top) * g.scale };
    },
  };
}

/** Draw the adjusted image into a canvas (optionally scaled down for previews). */
export function drawAdjusted(img: CanvasImageSource, w: number, h: number, adj: Adjustment, maxSide = MAX_IMAGE_SIDE): HTMLCanvasElement {
  const g = geometry(w, h, adj, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = g.width;
  canvas.height = g.height;
  const ctx = canvas.getContext('2d')!;
  // Without a background colour the canvas stays transparent (WebP/PNG keep alpha).
  if (adj.background?.kind === 'color') {
    ctx.fillStyle = adj.background.color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(g.scale, g.scale);
  ctx.translate(g.pad.left - g.crop.x, g.pad.top - g.crop.y);
  ctx.translate(g.rot.width / 2, g.rot.height / 2);
  ctx.rotate((g.deg * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return canvas;
}

/** Apply rotation/straightening/crop and re-encode to WebP. */
export async function adjustImage(image: DraftImage, adj: Adjustment): Promise<DraftImage> {
  const url = URL.createObjectURL(image.blob);
  try {
    const img = await loadHtmlImage(url);
    const canvas = drawAdjusted(img, image.width, image.height, adj);
    const out = await canvasToBlob(canvas);
    return {
      uid: newUid(),
      name: image.name,
      file: image.file ? image.file.replace(/\.[^.]+$/, `.${out.type}`) : undefined,
      blob: out.blob,
      type: out.type,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Move a label box along with an adjustment (its centre follows the image; size scales). */
export function adjustBox(box: Box, image: { width: number; height: number }, adj: Adjustment): Box {
  const t = adjustmentTransform(image.width, image.height, adj);
  const c = t.map(box.x + box.w / 2, box.y + box.h / 2);
  const w = box.w * t.scale;
  const h = box.h * t.scale;
  return { x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

/** Move a point (leader anchor or elbow) along with an adjustment. */
export function adjustPoint(p: ImagePoint, image: { width: number; height: number }, adj: Adjustment): ImagePoint {
  const q = adjustmentTransform(image.width, image.height, adj).map(p.x, p.y);
  return { x: Math.round(q.x), y: Math.round(q.y) };
}

/** The photo's background colour, from its border (see detectBackground). */
export async function detectImageBackground(image: Pick<DraftImage, 'blob' | 'width' | 'height'>, maxSide = 600): Promise<BorderColour> {
  const url = URL.createObjectURL(image.blob);
  try {
    const img = await loadHtmlImage(url);
    const small = drawAdjusted(img, image.width, image.height, { rotate: 0, straighten: 0, crop: null }, maxSide);
    const data = small.getContext('2d')!.getImageData(0, 0, small.width, small.height).data;
    return detectBackground(data, small.width, small.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}
