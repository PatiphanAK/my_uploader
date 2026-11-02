import { sleep } from "../retry";
import type {
  PresignedPart,
  SignPartsRequest,
  TransportRequest,
  TransportResponse,
  UploadBackendAdapter,
  UploadStatusResponse,
} from "../types";

export const STORAGE_HOST = "storage.test";

export function partFromUrl(url: string): number {
  return Number(new URL(url).pathname.split("/").pop());
}

type Scripted = { status: number; text?: string } | "no-etag";

/**
 * Fake object storage. Reports progress in two steps, honours abort signals,
 * tracks concurrency and lets tests script per-part failures.
 */
export function createFakeStorage(opts: { delayMs?: number } = {}) {
  const delay = opts.delayMs ?? 2;
  const script = new Map<number, Scripted[]>();
  const calls: Array<{ part: number; headers: Record<string, string>; size: number }> = [];
  let active = 0;
  let maxActive = 0;
  let aborted = 0;

  return {
    calls,
    get maxActive() {
      return maxActive;
    },
    get aborted() {
      return aborted;
    },
    fail(part: number, ...outcomes: Scripted[]) {
      script.set(part, [...(script.get(part) ?? []), ...outcomes]);
    },
    transport: {
      async send(req: TransportRequest): Promise<TransportResponse> {
        const part = partFromUrl(req.url);
        const size = (req.body as Blob).size;
        calls.push({ part, headers: { ...req.headers }, size });
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          await sleep(delay, req.signal);
          req.onProgress?.(Math.floor(size / 2));
          await sleep(delay, req.signal);
          const next = script.get(part)?.shift();
          if (next === "no-etag") return { status: 200, text: "", getHeader: () => null };
          if (next) return { status: next.status, text: next.text ?? "", getHeader: () => null };
          req.onProgress?.(size);
          return {
            status: 200,
            text: "",
            getHeader: (n) => (n.toLowerCase() === "etag" ? `"etag-${part}"` : null),
          };
        } catch (e) {
          aborted++;
          throw e;
        } finally {
          active--;
        }
      },
    },
  };
}

export function createFakeAdapter(overrides: Partial<UploadBackendAdapter> = {}) {
  const signCalls: SignPartsRequest[] = [];
  const aborts: string[] = [];
  const adapter: UploadBackendAdapter = {
    id: "fake",
    async initiate() {
      throw new Error("not scripted");
    },
    async signParts(req) {
      signCalls.push(req);
      const parts: PresignedPart[] = req.parts.map((p) => ({
        partNumber: p.partNumber,
        url: `https://${STORAGE_HOST}/u/${p.partNumber}`,
      }));
      return { parts };
    },
    async complete(req): Promise<UploadStatusResponse> {
      return { uploadId: req.uploadId, state: "completed" };
    },
    async abort(req) {
      aborts.push(req.uploadId);
    },
    async getStatus(uploadId) {
      return { uploadId, state: "completed" };
    },
    ...overrides,
  };
  return { adapter, signCalls, aborts };
}

export const noSleep = async () => {};

export function makeFile(size: number, name = "data.bin", type = "application/octet-stream"): File {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = i % 251;
  return new File([bytes], name, { type, lastModified: 1_700_000_000_000 });
}
