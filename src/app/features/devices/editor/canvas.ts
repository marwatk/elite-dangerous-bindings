/**
 * The canvas of each draft image: while editing, boxes and leader lines may
 * sit beside the photo; on export the image grows to hold them. This file is
 * the pure geometry (what the canvas is, where everything moves to); the
 * pixels are drawn by image-tools' adjustImage().
 */
import { Box, ImagePoint } from '../../../core/data/catalog.types';
import { CanvasBackground, CanvasSettings, DEFAULT_CANVAS, Padding, canvasPadding, hasPadding } from './canvas-padding';
import { DraftImage, EditorDraft } from './draft';
import { Adjustment, adjustBox, adjustPoint, adjustedSize } from './image-tools';

export function canvasSettings(d: Pick<EditorDraft, 'canvas'>): CanvasSettings {
  return { ...DEFAULT_CANVAS, ...d.canvas };
}

/** Boxes and leader points drawn on image `index`. */
export function contentOn(d: EditorDraft, index: number): { boxes: Box[]; points: ImagePoint[] } {
  const boxes: Box[] = [];
  const points: ImagePoint[] = [];
  for (const c of [...d.controls, ...(d.groups ?? [])]) {
    if (!c.box || (c.image ?? 0) !== index) continue;
    boxes.push(c.box);
    if (c.leader) points.push(...c.leader);
  }
  return { boxes, points };
}

/** Space the canvas adds around image `index`. */
export function canvasPaddingFor(d: EditorDraft, index: number): Padding {
  const img = d.images[index];
  if (!img) return { top: 0, right: 0, bottom: 0, left: 0 };
  const { boxes, points } = contentOn(d, index);
  return canvasPadding(img, boxes, points, canvasSettings(d));
}

/** The image adjustment that produces the canvas. */
export function canvasAdjustment(pad: Padding, background: CanvasBackground | null = null): Adjustment {
  return { rotate: 0, straighten: 0, crop: null, pad, background };
}

/** Output size of image `index` with its canvas. */
export function canvasOutputSize(d: EditorDraft, index: number): { width: number; height: number } {
  const img = d.images[index];
  return adjustedSize(img.width, img.height, canvasAdjustment(canvasPaddingFor(d, index)));
}

/**
 * The draft as it will be exported: every image grown to its canvas and its
 * boxes and leader points moved (and scaled, past the size limit) to match.
 * Images whose canvas is the image itself are left untouched. `rendered`
 * supplies the drawn images; without it the blobs stay the originals (for
 * previews of the geometry) and the type becomes WebP.
 */
export function applyCanvas(d: EditorDraft, rendered?: ReadonlyMap<number, DraftImage>): EditorDraft {
  const adjustments = d.images.map((_, i) => {
    const pad = canvasPaddingFor(d, i);
    return hasPadding(pad) ? canvasAdjustment(pad) : null;
  });
  if (!adjustments.some(Boolean)) return d;
  const images = d.images.map((img, i) => {
    const adj = adjustments[i];
    if (!adj) return img;
    const r = rendered?.get(i);
    if (r) return r;
    const size = adjustedSize(img.width, img.height, adj);
    return { ...img, ...size, type: 'webp' as const, file: img.file?.replace(/\.[^.]+$/, '.webp') };
  });
  const move = <T extends { box?: Box; image?: number; leader?: ImagePoint[] }>(c: T): T => {
    const i = c.image ?? 0;
    const adj = c.box ? adjustments[i] : null;
    if (!c.box || !adj) return c;
    const img = d.images[i];
    const out = { ...c, box: adjustBox(c.box, img, adj) };
    if (c.leader) out.leader = c.leader.map((p) => adjustPoint(p, img, adj));
    return out;
  };
  return { ...d, images, controls: d.controls.map(move), ...(d.groups ? { groups: d.groups.map(move) } : {}) };
}
