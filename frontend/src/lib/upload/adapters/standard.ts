import { parseInitiateResponse, parseSignPartsResponse, parseStatusResponse } from "../contract";
import { assertSafeApiBase } from "../destination";
import { errorFromApiStatus, toUploadError, UploadError } from "../errors";
import type {
  AbortUploadRequest,
  AdapterContext,
  CompleteUploadRequest,
  InitiateUploadRequest,
  SignPartsRequest,
  UploadBackendAdapter,
} from "../types";

/**
 * Adapter for the Universal Upload Protocol v1 (docs/backend-integration.md).
 *
 * Route templates can be overridden per profile, so a backend with different
 * paths but the same JSON shapes needs no new adapter. Backends with different
 * shapes should get their own adapter module next to this one.
 */

export interface StandardRoutes {
  initiate: string;
  signParts: string;
  complete: string;
  abort: string;
  status: string;
}

export const DEFAULT_ROUTES: StandardRoutes = {
  initiate: "POST /uploads",
  signParts: "POST /uploads/{uploadId}/parts",
  complete: "POST /uploads/{uploadId}/complete",
  abort: "DELETE /uploads/{uploadId}",
  status: "GET /uploads/{uploadId}",
};

export interface StandardAdapterOptions {
  baseUrl: string;
  routes?: Partial<StandardRoutes>;
  fetch?: typeof fetch;
}

export function createStandardAdapter(opts: StandardAdapterOptions): UploadBackendAdapter {
  const base = assertSafeApiBase(opts.baseUrl);
  const routes = { ...DEFAULT_ROUTES, ...opts.routes };
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function call(route: string, ctx: AdapterContext, uploadId?: string, body?: unknown): Promise<unknown> {
    const [method, pathTemplate] = route.trim().split(/\s+/, 2);
    if (!pathTemplate) throw new UploadError("protocol", `Invalid route "${route}"`);
    const path = pathTemplate.replace("{uploadId}", encodeURIComponent(uploadId ?? ""));
    const url = base + (path.startsWith("/") ? path : `/${path}`);

    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers: {
          Accept: "application/json",
          // API authentication only. Storage requests never see this header.
          Authorization: `Bearer ${ctx.uploadKey}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctx.signal,
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        redirect: "error",
      });
    } catch (err) {
      throw toUploadError(err);
    }

    const text = await res.text().catch(() => "");
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        if (res.ok) throw new UploadError("protocol", "Backend returned non-JSON response");
      }
    }
    if (!res.ok) {
      const message =
        json && typeof json === "object" && "error" in json
          ? (json as { error?: { message?: unknown } }).error?.message
          : undefined;
      throw errorFromApiStatus(res.status, typeof message === "string" ? message : undefined);
    }
    return json;
  }

  return {
    id: "standard",
    async initiate(req: InitiateUploadRequest, ctx) {
      return parseInitiateResponse(await call(routes.initiate, ctx, undefined, req));
    },
    async signParts(req: SignPartsRequest, ctx) {
      return parseSignPartsResponse(await call(routes.signParts, ctx, req.uploadId, { parts: req.parts }));
    },
    async complete(req: CompleteUploadRequest, ctx) {
      const { uploadId, ...body } = req;
      return parseStatusResponse(await call(routes.complete, ctx, uploadId, body));
    },
    async abort(req: AbortUploadRequest, ctx) {
      await call(routes.abort, ctx, req.uploadId, req.reason ? { reason: req.reason } : undefined);
    },
    async getStatus(uploadId: string, ctx) {
      return parseStatusResponse(await call(routes.status, ctx, uploadId));
    },
  };
}
