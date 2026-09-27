import { Measure, REF_SIZE } from './text-fit';

/** Font stacks: the on-screen/SVG card font and the PDF font (jsPDF's built-in Helvetica). */
export const CARD_FONT = "'Exo 2', Roboto, sans-serif";
export const PDF_FONT = 'helvetica';
const PDF_MEASURE_FONT = 'Helvetica, Arial, "Liberation Sans", sans-serif';

/** A cached canvas-2D text measurer for a font stack. */
export function canvasMeasure(fontStack: string): Measure {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const ctx = canvas?.getContext('2d') ?? null;
  const cache = new Map<string, number>();
  return (text: string, bold: boolean): number => {
    const k = `${bold ? 1 : 0}${text}`;
    let w = cache.get(k);
    if (w === undefined) {
      if (ctx) {
        ctx.font = `${bold ? 700 : 400} ${REF_SIZE}px ${fontStack}`;
        w = ctx.measureText(text).width;
      } else {
        w = text.length * REF_SIZE * 0.55;
      }
      cache.set(k, w);
    }
    return w;
  };
}

export function cardMeasure(): Measure {
  return canvasMeasure(CARD_FONT);
}

export function pdfMeasure(): Measure {
  return canvasMeasure(PDF_MEASURE_FONT);
}

/** Resolve once the card font is available for canvas measurement (or after a timeout). */
export async function cardFontsReady(timeoutMs = 4000): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const load = Promise.all([
    document.fonts.load(`400 40px 'Exo 2'`),
    document.fonts.load(`700 40px 'Exo 2'`),
  ]).then(() => document.fonts.ready);
  await Promise.race([load.catch(() => undefined), new Promise((r) => setTimeout(r, timeoutMs))]);
}
