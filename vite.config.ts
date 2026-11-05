// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// Restrict node polyfills to the client bundle. The SSR/Worker environment
// already has nodejs_compat and breaks when these shims rewrite `node:*` imports.
function clientOnlyNodePolyfills() {
  const plugins = nodePolyfills({
    // Do not polyfill `process` in the browser: TanStack Start injects
    // `process.env.TSS_SERVER_FN_BASE` at build time for server functions, and
    // the browser shim replaces it with an empty object, making RPC URLs start
    // with `undefined...`.
    globals: { Buffer: true, global: true, process: false },
    protocolImports: true,
  }) as any[];
  return plugins.map((p) => {
    const wrapped: any = { ...p };
    wrapped.applyToEnvironment = (env: any) => env.name === "client";
    if (typeof p.config === "function") {
      wrapped.config = (cfg: any, env: any) => {
        const result = p.config.call(p, cfg, env);
        if (!result) return result;
        // Move client-only contributions under environments.client so SSR/nitro
        // don't inherit the browser shim aliases.
        const { resolve, optimizeDeps, build, ...rest } = result as any;
        return {
          ...rest,
          environments: {
            client: { resolve, optimizeDeps, build },
          },
        };
      };
    }
    return wrapped;
  });
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      clientOnlyNodePolyfills(),
      // Strip polyfill aliases out of the server/nitro environments — those run
      // under Cloudflare Workers (nodejs_compat) and should resolve `node:*`
      // imports natively, not via the browser shims.
      {
        name: "lovable:server-no-node-polyfills",
        enforce: "post" as const,
        configEnvironment(name: string, config: any) {
          if (name === "client") return;
          const aliases = config?.resolve?.alias;
          if (!aliases) return;
          const stripObj = (obj: Record<string, string>) => {
            for (const k of Object.keys(obj)) {
              if (obj[k]?.includes?.("vite-plugin-node-polyfills/shims")) {
                delete obj[k];
              }
            }
          };
          if (Array.isArray(aliases)) {
            config.resolve.alias = aliases.filter(
              (a: any) =>
                !(typeof a.replacement === "string" &&
                  a.replacement.includes("vite-plugin-node-polyfills/shims")),
            );
          } else if (typeof aliases === "object") {
            stripObj(aliases);
          }
        },
      },
    ],
    optimizeDeps: {
      include: ["@mtcute/web"],
    },
  },
});
