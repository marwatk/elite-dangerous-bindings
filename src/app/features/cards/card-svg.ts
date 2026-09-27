import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input } from '@angular/core';

/**
 * Shows a rendered card. The SVG markup (built and escaped by card-render.ts)
 * is parsed as XML and inserted as DOM, so the page shows exactly what is
 * downloaded, without Angular re-rendering thousands of text nodes.
 */
@Component({
  selector: 'app-card-svg',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
  styles: `
    :host {
      display: block;
      line-height: 0;
    }
    :host ::ng-deep svg {
      display: block;
      width: 100%;
      height: auto;
    }
  `,
})
export class CardSvg {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly svg = input.required<string>();

  constructor() {
    effect(() => {
      const doc = new DOMParser().parseFromString(this.svg(), 'image/svg+xml');
      const el = doc.documentElement;
      if (el.nodeName !== 'svg') return;
      el.removeAttribute('width');
      el.removeAttribute('height');
      this.host.nativeElement.replaceChildren(document.importNode(el, true));
    });
  }
}
