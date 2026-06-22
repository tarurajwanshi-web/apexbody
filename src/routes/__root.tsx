import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { UpdateAvailableBanner } from "../components/UpdateAvailableBanner";

declare const __APP_BUILD_TIMESTAMP__: string;
const APP_BUILD_TIMESTAMP =
  typeof __APP_BUILD_TIMESTAMP__ !== "undefined" ? __APP_BUILD_TIMESTAMP__ : "unknown";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-1 px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold gradient-text">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-text-secondary">
          This screen doesn't exist.
        </p>
        <Link to="/" className="mt-6 inline-flex rounded-2xl gradient-brand px-5 py-2.5 text-sm font-medium text-white">
          Go home
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-1 px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-text-secondary">Try again or head home.</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-6 inline-flex rounded-2xl gradient-brand px-5 py-2.5 text-sm font-medium text-white"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#0A0B0F" },
      { httpEquiv: "Cache-Control", content: "no-cache, no-store, must-revalidate" },
      { httpEquiv: "Pragma", content: "no-cache" },
      { httpEquiv: "Expires", content: "0" },
      { name: "app-version", content: APP_BUILD_TIMESTAMP },
      { title: "APEX — Adaptive Performance Coach" },
      { name: "description", content: "AI-first performance coaching. Adaptive training, nutrition and recovery — built around your data." },
      { property: "og:title", content: "APEX — Adaptive Performance Coach" },
      { property: "og:description", content: "AI-first performance coaching. Adaptive training, nutrition and recovery — built around your data." },
      { property: "og:type", content: "website" },
      // iOS PWA
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "APEX" },
      { name: "twitter:title", content: "APEX — Adaptive Performance Coach" },
      { name: "twitter:description", content: "AI-first performance coaching. Adaptive training, nutrition and recovery — built around your data." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/acefd610-18a0-45d9-98eb-23d500be8032/id-preview-ad420ad9--23b7cc0e-cc45-480f-a556-d51abcb48d02.lovable.app-1782152225407.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/acefd610-18a0-45d9-98eb-23d500be8032/id-preview-ad420ad9--23b7cc0e-cc45-480f-a556-d51abcb48d02.lovable.app-1782152225407.png" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "serviceworker", href: "/sw.js" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/icon-512.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap",
      },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="bg-bg-0">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.log('SW registration failed:', err);
      });
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <UpdateAvailableBanner />
      <div className="bg-bg-0 min-h-screen">
        <div className="phone-frame">
          <Outlet />
        </div>
      </div>
    </QueryClientProvider>
  );
}
