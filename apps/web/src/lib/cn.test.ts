import { describe, it, expect } from "vitest";
import { cn } from "./cn";

describe("cn()", () => {
  it("combina classes simples", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("resolve conflito de Tailwind", () => {
    expect(cn("px-4", "px-2")).toBe("px-2");
  });

  it("ignora valores falsy", () => {
    expect(cn("foo", false && "bar", undefined, null)).toBe("foo");
  });

  it("aceita objetos condicionais", () => {
    expect(cn("base", { active: true, disabled: false })).toBe("base active");
  });
});
