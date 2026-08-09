// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebounce, useMediaQuery, useKeyboardShortcut } from "./hooks";

describe("useDebounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retorna o valor inicial imediatamente", () => {
    const { result } = renderHook(() => useDebounce("teste", 300));
    expect(result.current).toBe("teste");
  });

  it("atualiza o valor apos o delay", () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: "inicial", delay: 300 } }
    );

    expect(result.current).toBe("inicial");

    rerender({ value: "atualizado", delay: 300 });
    expect(result.current).toBe("inicial");

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe("atualizado");
  });

  it("cancela o timer anterior quando o valor muda rapidamente", () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: "a", delay: 300 } }
    );

    rerender({ value: "b", delay: 300 });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    rerender({ value: "c", delay: 300 });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe("c");
  });
});

describe("useMediaQuery", () => {
  const listeners: Array<(e: MediaQueryListEvent) => void> = [];

  beforeEach(() => {
    listeners.length = 0;
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(max-width: 767px)",
        media: query,
        addEventListener: (_event: string, handler: (e: MediaQueryListEvent) => void) => {
          listeners.push(handler);
        },
        removeEventListener: (_event: string, _handler: (e: MediaQueryListEvent) => void) => {
          // noop para teste
        },
      })),
    });
  });

  it("retorna o valor inicial da media query", () => {
    const { result } = renderHook(() => useMediaQuery("(max-width: 767px)"));
    expect(result.current).toBe(true);
  });

  it("retorna false quando a media query nao corresponde", () => {
    const { result } = renderHook(() => useMediaQuery("(min-width: 1024px)"));
    expect(result.current).toBe(false);
  });

  it("atualiza quando a media query muda", () => {
    const { result } = renderHook(() => useMediaQuery("(max-width: 767px)"));
    expect(result.current).toBe(true);

    act(() => {
      for (const listener of listeners) {
        listener({ matches: false } as MediaQueryListEvent);
      }
    });

    expect(result.current).toBe(false);
  });
});

describe("useKeyboardShortcut", () => {
  it("chama o callback quando a tecla corresponde", () => {
    const callback = vi.fn();
    renderHook(() => useKeyboardShortcut("k", callback));

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k" })
      );
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("chama o callback com modificador ctrlKey", () => {
    const callback = vi.fn();
    renderHook(() => useKeyboardShortcut("k", callback, { ctrlKey: true }));

    // Sem ctrl - nao deve chamar
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: false })
      );
    });
    expect(callback).not.toHaveBeenCalled();

    // Com ctrl - deve chamar
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true })
      );
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("ignora teclas que nao correspondem", () => {
    const callback = vi.fn();
    renderHook(() => useKeyboardShortcut("k", callback));

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "j" })
      );
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it("corresponde independente de maiusculas/minusculas", () => {
    const callback = vi.fn();
    renderHook(() => useKeyboardShortcut("k", callback));

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "K" })
      );
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });
});
