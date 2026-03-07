/**
 * Lightweight replacement for @x402/next to avoid pulling in @coinbase/cdp-sdk (132MB) and @solana (36MB).
 * Only implements what we actually use: withX402 and x402ResourceServer (re-exported from @x402/core).
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  x402ResourceServer,
  x402HTTPResourceServer,
} from "@x402/core/server";
import type { RouteConfig, PaywallConfig } from "@x402/core/server";

class NextAdapter {
  constructor(private req: NextRequest) {}

  getHeader(name: string) {
    return this.req.headers.get(name) || undefined;
  }
  getMethod() {
    return this.req.method;
  }
  getPath() {
    return this.req.nextUrl.pathname;
  }
  getUrl() {
    return this.req.url;
  }
  getAcceptHeader() {
    return this.req.headers.get("Accept") || "";
  }
  getUserAgent() {
    return this.req.headers.get("User-Agent") || "";
  }
  getQueryParams() {
    const params: Record<string, string | string[]> = {};
    this.req.nextUrl.searchParams.forEach((value, key) => {
      const existing = params[key];
      if (existing) {
        if (Array.isArray(existing)) existing.push(value);
        else params[key] = [existing, value];
      } else {
        params[key] = value;
      }
    });
    return params;
  }
  getQueryParam(name: string) {
    const all = this.req.nextUrl.searchParams.getAll(name);
    if (all.length === 0) return undefined;
    if (all.length === 1) return all[0];
    return all;
  }
  async getBody() {
    try {
      return await this.req.json();
    } catch {
      return undefined;
    }
  }
}

function handlePaymentError(response: any) {
  const headers = new Headers(response.headers);
  if (response.isHtml) {
    headers.set("Content-Type", "text/html");
    return new NextResponse(response.body, { status: response.status, headers });
  }
  headers.set("Content-Type", "application/json");
  return new NextResponse(JSON.stringify(response.body || {}), { status: response.status, headers });
}

async function handleSettlement(
  httpServer: any,
  response: NextResponse,
  paymentPayload: any,
  paymentRequirements: any,
  declaredExtensions: any,
  httpContext: any,
) {
  if (response.status >= 400) return response;
  try {
    const responseBody = Buffer.from(await response.clone().arrayBuffer());
    const result = await httpServer.processSettlement(
      paymentPayload,
      paymentRequirements,
      declaredExtensions,
      { request: httpContext, responseBody },
    );
    if (!result.success) {
      return new NextResponse(
        JSON.stringify({ error: "Settlement failed", details: result.errorReason }),
        { status: 402, headers: { "Content-Type": "application/json" } },
      );
    }
    Object.entries(result.headers).forEach(([key, value]) => {
      response.headers.set(key, value as string);
    });
    return response;
  } catch (error) {
    console.error("Settlement failed:", error);
    return new NextResponse(
      JSON.stringify({
        error: "Settlement failed",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 402, headers: { "Content-Type": "application/json" } },
    );
  }
}

export function withX402(
  routeHandler: (req: NextRequest) => Promise<NextResponse>,
  routeConfig: RouteConfig,
  server: InstanceType<typeof x402ResourceServer>,
  paywallConfig?: PaywallConfig,
  paywall?: any,
  syncFacilitatorOnStart = true,
) {
  const routes = { "*": routeConfig };
  const httpServer = new x402HTTPResourceServer(server, routes);

  if (paywall) httpServer.registerPaywallProvider(paywall);
  let initPromise: Promise<void> | null = syncFacilitatorOnStart ? httpServer.initialize() : null;

  return async (request: NextRequest) => {
    if (initPromise) {
      await initPromise;
      initPromise = null;
    }

    const adapter = new NextAdapter(request);
    const context = {
      adapter,
      path: request.nextUrl.pathname,
      method: request.method,
      paymentHeader: adapter.getHeader("payment-signature") || adapter.getHeader("x-payment"),
    };

    const result = await httpServer.processHTTPRequest(context, paywallConfig);
    switch (result.type) {
      case "no-payment-required":
        return routeHandler(request);
      case "payment-error":
        return handlePaymentError(result.response);
      case "payment-verified": {
        const { paymentPayload, paymentRequirements, declaredExtensions } = result;
        const handlerResponse = await routeHandler(request);
        return handleSettlement(
          httpServer,
          handlerResponse,
          paymentPayload,
          paymentRequirements,
          declaredExtensions,
          context,
        );
      }
    }
  };
}

// Re-export what we use from core
export { x402ResourceServer, x402HTTPResourceServer } from "@x402/core/server";
