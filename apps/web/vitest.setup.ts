import '@testing-library/jest-dom/vitest';
import { afterEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from 'vitest-axe/matchers';

expect.extend(matchers);
afterEach(() => { cleanup(); });

/* ── Mocks globais para JSDOM ──────────────────────────────────────────── */

// ResizeObserver funcional (necessario para @visx/responsive ParentSize)
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; }
    observe(target: Element) {
      // Dispara imediatamente com dimensoes padroes
      this.cb([{
        target,
        contentRect: { x: 0, y: 0, width: 500, height: 300, top: 0, left: 0, bottom: 300, right: 500, toJSON: () => '' },
        borderBoxSize: [{ blockSize: 300, inlineSize: 500 }],
        contentBoxSize: [{ blockSize: 300, inlineSize: 500 }],
        devicePixelContentBoxSize: [],
      } as ResizeObserverEntry], this);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Metodos SVG ausentes em JSDOM (necessarios para @visx/axis)
if (typeof SVGElement !== 'undefined') {
  const proto = SVGElement.prototype as unknown as Record<string, unknown>;
  if (!proto.getComputedTextLength) proto.getComputedTextLength = () => 0;
  if (!proto.getBBox) proto.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
}
