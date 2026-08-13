import '@testing-library/jest-dom/vitest';
import { afterEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from 'vitest-axe/matchers';

expect.extend(matchers);
afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

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

// axe-core e os graficos consultam canvas apenas para medir texto/cor. O JSDOM
// expõe getContext(), mas a implementação padrão só escreve dezenas de erros no
// stderr e devolve null. Este contexto mínimo mantém o contrato que os testes
// realmente usam sem instalar um renderer nativo de canvas no CI.
if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({
      canvas: document.createElement('canvas'),
      fillStyle: '#000000',
      font: '14px sans-serif',
      measureText: (text: string) => ({
        width: text.length * 7,
        actualBoundingBoxAscent: 10,
        actualBoundingBoxDescent: 3,
      }),
      clearRect: () => undefined,
      fillRect: () => undefined,
      getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
      putImageData: () => undefined,
      save: () => undefined,
      restore: () => undefined,
      scale: () => undefined,
      translate: () => undefined,
    }),
  });
}
