import { BreakpointObserver } from '@angular/cdk/layout';
import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { InputRef } from '../../core/binds/binds-document';
import { CatalogService } from '../../core/data/catalog.service';
import { BindingsStore } from '../../core/state/bindings-store.service';
import { cardsToPdf, downloadBlob, embeddedFontCss, fetchDataUrl, safeFileName, svgToPngBlob, toJpegDataUrl } from './card-export';
import { Card, UnplacedReason, buildCards, cardEntries, chooseCards, usedDevices } from './card-model';
import { KeyboardStyle, RenderContext, RenderedCard, renderCard } from './card-render';
import { CardSvg } from './card-svg';
import { CARD_FONT, PDF_FONT, cardFontsReady, cardMeasure, pdfMeasure } from './measure';
import { CARD_GROUPS, COLOUR_SCHEMES, ColourScheme } from './palette';

const PREFS_KEY = 'edb.cards.options';

interface Prefs {
  groups: string[];
  scheme: ColourScheme;
  compact: boolean;
  keyboardStyle: KeyboardStyle;
  /** Card IDs left out. */
  hidden: string[];
}

const DEFAULT_PREFS: Prefs = {
  groups: CARD_GROUPS.map((g) => g.value),
  scheme: 'group',
  compact: false,
  keyboardStyle: 'graphic',
  hidden: [],
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      groups: Array.isArray(p.groups) ? p.groups.filter((g) => typeof g === 'string') : DEFAULT_PREFS.groups,
      scheme: COLOUR_SCHEMES.some((s) => s.value === p.scheme) ? p.scheme! : DEFAULT_PREFS.scheme,
      compact: typeof p.compact === 'boolean' ? p.compact : DEFAULT_PREFS.compact,
      keyboardStyle: p.keyboardStyle === 'list' ? 'list' : 'graphic',
      hidden: Array.isArray(p.hidden) ? p.hidden.filter((h) => typeof h === 'string') : [],
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

const REASONS: Record<UnplacedReason, string> = {
  mouse: 'Mouse bindings are not drawn on cards',
  unsupported: 'Device not supported',
  'no-artwork': 'No artwork for this device',
  'no-box': 'No label position on the card',
};

interface CardView {
  card: Card;
  rendered: RenderedCard;
  count: number;
}

@Component({
  selector: 'app-cards-page',
  imports: [
    CardSvg,
    MatButtonModule,
    MatCheckboxModule,
    MatExpansionModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatRadioModule,
    MatSlideToggleModule,
    MatSnackBarModule,
    MatTooltipModule,
    NgTemplateOutlet,
    RouterLink,
  ],
  templateUrl: './cards-page.html',
  styleUrl: './cards-page.scss',
  // Unencapsulated so the print rules (@page, app shell overrides) apply; every
  // selector is scoped under app-cards-page. Removed when the page is left.
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardsPage {
  protected readonly store = inject(BindingsStore);
  private readonly catalog = inject(CatalogService);
  private readonly snack = inject(MatSnackBar);

  protected readonly groups = CARD_GROUPS;
  protected readonly schemes = COLOUR_SCHEMES;
  protected readonly prefs = signal<Prefs>(loadPrefs());
  protected readonly busy = signal<string | null>(null);
  protected readonly fontsReady = signal(false);
  /** Created once so measured widths are cached across option changes. */
  private readonly measure = cardMeasure();
  private readonly date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  protected readonly wide = toSignal(
    inject(BreakpointObserver)
      .observe('(min-width: 1100px)')
      .pipe(map((s) => s.matches)),
    { initialValue: true },
  );

  private readonly groupSet = computed(() => new Set(this.prefs().groups));

  private readonly choices = computed(() =>
    chooseCards(usedDevices(this.store.actions()), this.catalog.devices(), (b, i) => this.catalog.deviceFor(b, i)),
  );

  /** Cards and their text; recomputed only when the file, catalogue or options change. */
  protected readonly cardSet = computed(() => {
    this.catalog.actions();
    const defs = this.catalog.definitions();
    const p = this.prefs();
    return buildCards(
      {
        actions: this.store.actions(),
        meta: (c) => this.catalog.action(c),
        devices: this.catalog.devices(),
        definition: (id) => defs.get(id) ?? this.catalog.localDevice(id)?.definition,
        preferred: (b, i) => this.catalog.deviceFor(b, i),
        options: { groups: this.groupSet(), compact: p.compact },
      },
      this.choices(),
    );
  });

  protected readonly allCards = computed(() =>
    this.cardSet().cards.map((card) => ({
      card,
      count: cardEntries(card).filter((e) => e.kind === 'action').length,
    })),
  );

  protected readonly hasKeyboard = computed(() => this.cardSet().cards.some((c) => c.kind === 'keyboard'));

  /** Device cards whose definition is still loading. */
  protected readonly loading = computed(() =>
    this.cardSet().cards.filter((c) => c.kind === 'device' && !this.definition(c.deviceId)),
  );

  protected readonly views = computed<CardView[]>(() => {
    if (!this.fontsReady()) return [];
    const hidden = new Set(this.prefs().hidden);
    const measure = this.measure;
    const out: CardView[] = [];
    for (const { card, count } of this.allCards()) {
      if (hidden.has(card.id)) continue;
      const ctx = this.context(card, measure, CARD_FONT);
      if (!ctx) continue;
      out.push({ card, count, rendered: renderCard(card, ctx) });
    }
    return out;
  });

  protected readonly unplaced = computed(() =>
    this.cardSet()
      .unplaced.map((u) => {
        const ref: InputRef = { device: u.device, key: u.key, deviceIndex: u.deviceIndex };
        return {
          id: `${u.device}::${u.deviceIndex}::${u.key}`,
          input: this.catalog.inputLabel(ref),
          reason: REASONS[u.reason],
          actions: u.entries.map((e) => e.text).join(', '),
        };
      })
      .sort((a, b) => a.input.localeCompare(b.input)),
  );

  constructor() {
    void cardFontsReady().then(() => this.fontsReady.set(true));
    // Load the definitions of the chosen cards (aliases may name devices the store didn't load).
    effect(() => {
      for (const c of this.choices()) void this.catalog.loadDevice(c.deviceId).catch(() => undefined);
    });
    effect(() => {
      const p = this.prefs();
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(p));
      } catch {
        // Storage unavailable: options just aren't remembered.
      }
    });
  }

  // ------------------------------------------------------------ options

  protected hasGroup(g: string): boolean {
    return this.groupSet().has(g);
  }

  protected toggleGroup(g: string, on: boolean): void {
    this.prefs.update((p) => ({
      ...p,
      groups: on ? [...new Set([...p.groups, g])] : p.groups.filter((x) => x !== g),
    }));
  }

  protected setAllGroups(on: boolean): void {
    this.prefs.update((p) => ({ ...p, groups: on ? CARD_GROUPS.map((g) => g.value) : [] }));
  }

  protected setScheme(scheme: ColourScheme): void {
    this.prefs.update((p) => ({ ...p, scheme }));
  }

  protected setCompact(compact: boolean): void {
    this.prefs.update((p) => ({ ...p, compact }));
  }

  protected setKeyboardStyle(keyboardStyle: KeyboardStyle): void {
    this.prefs.update((p) => ({ ...p, keyboardStyle }));
  }

  protected isShown(id: string): boolean {
    return !this.prefs().hidden.includes(id);
  }

  protected toggleCard(id: string, on: boolean): void {
    this.prefs.update((p) => ({ ...p, hidden: on ? p.hidden.filter((h) => h !== id) : [...p.hidden, id] }));
  }

  // ------------------------------------------------------------ rendering

  private definition(id: string) {
    return this.catalog.definitions().get(id) ?? this.catalog.localDevice(id)?.definition;
  }

  private context(
    card: Card,
    measure: RenderContext['measure'],
    fontFamily: string,
    overrides: Partial<RenderContext> = {},
  ): RenderContext | null {
    const p = this.prefs();
    let image: RenderContext['image'] = null;
    let imageHref: string | null = null;
    if (card.kind === 'device') {
      const def = this.definition(card.deviceId);
      if (!def) return null;
      image = def.images[0] ?? null;
      imageHref = this.catalog.imageUrl(def, 0);
    }
    const keys = this.catalog.keys();
    return {
      scheme: p.scheme,
      measure,
      fontFamily,
      image,
      imageHref,
      keyboardStyle: p.keyboardStyle,
      keyLabel: (k) => keys.get(k)?.label ?? k.replace(/^Key_/, ''),
      inputLabel: (r) => (r.device === 'Keyboard' ? this.catalog.controlLabel(r) : this.catalog.inputLabel(r)),
      controlLabel: (r) => this.catalog.controlLabel(r),
      modifiers: this.cardSet().modifiers,
      footer: { preset: this.store.doc()?.presetName ?? '', file: this.store.source()?.name ?? '', date: this.date },
      ...overrides,
    };
  }

  private baseName(): string {
    const name = this.store.doc()?.presetName || this.store.source()?.name.replace(/(\.\d+)*\.binds$/i, '') || 'bindings';
    return safeFileName(name);
  }

  /** The card as a self-contained SVG (artwork and font embedded). */
  private async standaloneSvg(card: Card): Promise<RenderedCard> {
    const base = this.context(card, this.measure, CARD_FONT);
    if (!base) throw new Error('Card is still loading');
    const [imageHref, fontCss] = await Promise.all([
      base.imageHref ? fetchDataUrl(base.imageHref) : Promise.resolve(null),
      embeddedFontCss(),
    ]);
    return renderCard(card, { ...base, imageHref, fontCss });
  }

  protected async downloadSvg(v: CardView): Promise<void> {
    await this.run('Preparing SVG…', async () => {
      const r = await this.standaloneSvg(v.card);
      downloadBlob(new Blob([r.svg], { type: 'image/svg+xml' }), `${this.baseName()} - ${safeFileName(r.name)}.svg`);
    });
  }

  protected async downloadPng(v: CardView): Promise<void> {
    await this.run('Rendering PNG…', async () => {
      const r = await this.standaloneSvg(v.card);
      const blob = await svgToPngBlob(r.svg, r.width, r.height);
      downloadBlob(blob, `${this.baseName()} - ${safeFileName(r.name)}.png`);
    });
  }

  protected async downloadPdf(): Promise<void> {
    const views = this.views();
    if (!views.length) return;
    await this.run('Building PDF…', async () => {
      const measure = pdfMeasure();
      const pages = await Promise.all(
        views.map(async (v) => {
          const base = this.context(v.card, measure, PDF_FONT);
          if (!base) throw new Error('Card is still loading');
          const imageHref = base.imageHref ? await toJpegDataUrl(base.imageHref) : null;
          const r = renderCard(v.card, { ...base, imageHref });
          return {
            svg: r.svg,
            width: r.width,
            height: r.height,
            rasterSvg: async () => (await this.standaloneSvg(v.card)).svg,
          };
        }),
      );
      const blob = await cardsToPdf(pages);
      downloadBlob(blob, `${this.baseName()} - reference cards.pdf`);
    }, 'Could not build the PDF. Use Print → Save as PDF instead.');
  }

  protected print(): void {
    window.print();
  }

  private async run(label: string, fn: () => Promise<void>, failure?: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(label);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      this.snack.open(failure ?? `Download failed: ${(e as Error).message}`, 'Dismiss', { duration: 8000 });
    } finally {
      this.busy.set(null);
    }
  }
}
