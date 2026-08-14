"use client";

import * as RadixToast from "@radix-ui/react-toast";
import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { ToastItem, type ToastData } from "./Toast";

const MAX_VISIBLE = 5;

interface ToastContextValue {
  toast: (data: Omit<ToastData, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const toast = useCallback((data: Omit<ToastData, "id">) => {
    const id = crypto.randomUUID();
    setToasts((prev) => {
      const next = [...prev, { ...data, id }];
      // Limitar a MAX_VISIBLE toasts visiveis — remover os mais antigos
      if (next.length > MAX_VISIBLE) {
        return next.slice(next.length - MAX_VISIBLE);
      }
      return next;
    });
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      <RadixToast.Provider swipeDirection="right">
        {children}
        {toasts.map((t) => (
          <ToastItem key={t.id} data={t} onClose={() => removeToast(t.id)} />
        ))}
        <RadixToast.Viewport
          /* `w-80` + `right-4` = 336px: estoura viewport de 320px. E no topo o
             toast cobre os controles da TopBar. No celular vai para baixo,
             acima do dock (68px + respiro). */
          className="fixed top-4 right-4 z-[var(--z-toast)] m-0 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 p-0 outline-none max-md:inset-x-4 max-md:bottom-[calc(84px+env(safe-area-inset-bottom))] max-md:top-auto max-md:w-auto"
          data-testid="toast-viewport"
        />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast deve ser usado dentro de ToastProvider");
  }
  return ctx;
}
