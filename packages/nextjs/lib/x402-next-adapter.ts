/**
 * Lightweight replacement for @x402/next to avoid pulling in @coinbase/cdp-sdk (132MB) and @solana (36MB).
 * Only implements what we actually use: withX402 and x402ResourceServer (re-exported from @x402/core).
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { x402HTTPResourceServer, x402ResourceServer } from "@x402/core/server";
import type { PaywallConfig, RouteConfig } from "@x402/core/server";

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

function decodeBase64Json(value: string | null | undefined): any {
  if (!value) return undefined;
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf-8"));
  } catch {
    return undefined;
  }
}

/** Best-effort payer address from the client's PAYMENT-SIGNATURE payload (exact-EVM: EIP-3009 authorization.from). */
function extractPayer(paymentHeader: string | undefined): string | undefined {
  const payload = decodeBase64Json(paymentHeader);
  const from = payload?.payload?.authorization?.from ?? payload?.payload?.from;
  return typeof from === "string" ? from : undefined;
}

function handlePaymentError(response: any, paymentHeader?: string) {
  const headers = new Headers(response.headers);
  if (response.isHtml) {
    headers.set("Content-Type", "text/html");
    return new NextResponse(response.body, { status: response.status, headers });
  }
  headers.set("Content-Type", "application/json");
  // The x402 spec puts the rejection reason only inside the base64 PAYMENT-REQUIRED
  // header, leaving the body {}. Mirror it into the body so humans and debugging
  // agents can tell "wallet not funded" from "protocol broken" without decoding headers.
  let body = response.body;
  if (!body || (typeof body === "object" && Object.keys(body).length === 0)) {
    const required = decodeBase64Json(headers.get("PAYMENT-REQUIRED"));
    if (required?.error) {
      const payer = extractPayer(paymentHeader);
      body = {
        error: required.error,
        ...(payer ? { payer } : {}),
        detail: paymentHeader
          ? `Payment was rejected: ${required.error}. Full requirements are in the base64 PAYMENT-REQUIRED response header.`
          : "No payment attached. Sign the requirements in the base64 PAYMENT-REQUIRED response header and retry with a PAYMENT-SIGNATURE header (@x402/fetch does this automatically).",
      };
    }
  }
  return new NextResponse(JSON.stringify(body || {}), { status: response.status, headers });
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
    const result = await httpServer.processSettlement(paymentPayload, paymentRequirements, declaredExtensions, {
      request: httpContext,
      responseBody,
    });
    if (!result.success) {
      return new NextResponse(JSON.stringify({ error: "Settlement failed", details: result.errorReason }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      });
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
        return handlePaymentError(result.response, context.paymentHeader);
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

export function withX402Dynamic(
  routeHandler: (req: NextRequest) => Promise<NextResponse>,
  routeConfigFactory: (price: string) => RouteConfig,
  priceResolver: () => Promise<string>,
  server: InstanceType<typeof x402ResourceServer>,
  paywallConfig?: PaywallConfig,
) {
  // We can't pre-initialize because price is dynamic; we initialize per-price lazily
  const httpServerCache = new Map<string, { server: any; initPromise: Promise<void> | null }>();

  return async (request: NextRequest) => {
    const price = await priceResolver();
    const routeConfig = routeConfigFactory(price);

    let entry = httpServerCache.get(price);
    if (!entry) {
      const routes = { "*": routeConfig };
      const httpServer = new x402HTTPResourceServer(server, routes);
      entry = { server: httpServer, initPromise: httpServer.initialize() };
      httpServerCache.set(price, entry);
    }

    if (entry.initPromise) {
      await entry.initPromise;
      entry.initPromise = null;
    }

    const httpServer = entry.server;
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
        return handlePaymentError(result.response, context.paymentHeader);
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

/**
 * Settle-first variant: settles x402 payment BEFORE running the handler.
 * Required for routes that call postJobFor — the USDC must land in the
 * sanitizer wallet before the contract can pull it.
 */
export function withX402DynamicSettleFirst(
  routeHandler: (req: NextRequest) => Promise<NextResponse>,
  routeConfigFactory: (price: string) => RouteConfig,
  priceResolver: () => Promise<string>,
  server: InstanceType<typeof x402ResourceServer>,
  paywallConfig?: PaywallConfig,
) {
  const httpServerCache = new Map<string, { server: any; initPromise: Promise<void> | null }>();

  return async (request: NextRequest) => {
    const price = await priceResolver();
    const routeConfig = routeConfigFactory(price);

    let entry = httpServerCache.get(price);
    if (!entry) {
      const routes = { "*": routeConfig };
      const httpServer = new x402HTTPResourceServer(server, routes);
      entry = { server: httpServer, initPromise: httpServer.initialize() };
      httpServerCache.set(price, entry);
    }

    if (entry.initPromise) {
      await entry.initPromise;
      entry.initPromise = null;
    }

    const httpServer = entry.server;
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
        return handlePaymentError(result.response, context.paymentHeader);
      case "payment-verified": {
        const { paymentPayload, paymentRequirements, declaredExtensions } = result;

        // Settle FIRST so USDC lands in our wallet before the handler runs
        const settlementResult = await httpServer.processSettlement(
          paymentPayload,
          paymentRequirements,
          declaredExtensions,
          { request: context, responseBody: Buffer.from("{}") },
        );
        if (!settlementResult.success) {
          return new NextResponse(
            JSON.stringify({ error: "Settlement failed", details: settlementResult.errorReason }),
            { status: 402, headers: { "Content-Type": "application/json" } },
          );
        }

        const handlerResponse = await routeHandler(request);
        if (handlerResponse.status >= 400) return handlerResponse;

        Object.entries(settlementResult.headers).forEach(([key, value]) => {
          handlerResponse.headers.set(key, value as string);
        });
        return handlerResponse;
      }
    }
  };
}

// Re-export what we use from core
export { x402ResourceServer, x402HTTPResourceServer } from "@x402/core/server";
