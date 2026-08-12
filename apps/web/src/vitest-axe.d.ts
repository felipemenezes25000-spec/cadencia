import 'vitest';

/**
 * vitest-axe 0.1.0 augmenta `Vi.Assertion` (vitest <1.0).
 * vitest 4.x usa `declare module 'vitest'`.
 * Este arquivo faz a ponte para que `toHaveNoViolations()` seja reconhecido.
 */
declare module 'vitest' {
  interface Assertion<T = any> {
    /** Verifica que o resultado de `axe()` não contém violações WCAG. */
    toHaveNoViolations(): this;
  }

  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): this;
  }
}
