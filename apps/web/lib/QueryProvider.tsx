"use client";

/**
 * The TanStack Query client, mounted once for the whole app.
 *
 * WHY IT IS A CLIENT COMPONENT IN THE ROOT LAYOUT. Both builds render this
 * layout: the static Pages export and the hosted build. A `QueryClient` holds
 * a per-visitor cache, so it must be created inside the browser session and
 * never shared between two of them — `useState` with an initializer creates
 * exactly one per mount, which is the pattern TanStack documents for React
 * Server Components. Building it at module scope would make one client per
 * SERVER process in the hosted build, and one visitor's cached rows would be
 * handed to the next.
 *
 * THE DEFAULTS ARE THE POLICY, and each one is a decision:
 *
 *  - `retry: false`. `lib/serviceFetch.ts` turns every failure into a state a
 *    page renders as a sentence. Retrying three times behind that would make a
 *    dead service take four times as long to say so.
 *  - `refetchOnWindowFocus: false`. Reads here are pages, not a dashboard. A
 *    tab switch is not a reason to re-ask the service.
 *  - `staleTime: 30_000`. A reader who opens a card and comes back gets the
 *    wall they left, and the service is not asked again for half a minute.
 *
 * The static export ships this too. It costs the bundle bytes measured in
 * docs/ADR-zod-tanstack.md §3 and buys that build nothing, because it has no
 * exam service to read. That is stated there rather than hidden here.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
          mutations: { retry: false },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
