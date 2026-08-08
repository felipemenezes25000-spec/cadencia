'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { ToastProvider } from '../src/ui/ToastProvider';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        gcTime: 60_000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
    },
  }));
  return (
    <QueryClientProvider client={client}>
      <NuqsAdapter>
        <RadixTooltip.Provider delayDuration={300}>
          <ToastProvider>
            {children}
          </ToastProvider>
        </RadixTooltip.Provider>
      </NuqsAdapter>
    </QueryClientProvider>
  );
}
