import { abortError, UploadError } from "./errors";
import type { TransportRequest, TransportResponse, UploadTransport } from "./types";

/**
 * Browser transport for object-storage requests, built on XMLHttpRequest
 * because fetch() still lacks portable upload-progress events.
 *
 * - Sends the Blob/File directly; the browser streams it from disk.
 * - `withCredentials = false`: no cookies or ambient auth go to storage.
 */
export const xhrTransport: UploadTransport = {
  send(req: TransportRequest): Promise<TransportResponse> {
    return new Promise((resolve, reject) => {
      if (req.signal?.aborted) return reject(abortError());

      const xhr = new XMLHttpRequest();
      xhr.open(req.method, req.url, true);
      xhr.withCredentials = false;
      if (req.timeoutMs) xhr.timeout = req.timeoutMs;
      for (const [k, v] of Object.entries(req.headers ?? {})) xhr.setRequestHeader(k, v);

      const onAbort = () => xhr.abort();
      const cleanup = () => req.signal?.removeEventListener("abort", onAbort);
      req.signal?.addEventListener("abort", onAbort, { once: true });

      if (req.onProgress) {
        const cb = req.onProgress;
        xhr.upload.onprogress = (e) => cb(e.loaded);
      }
      xhr.onload = () => {
        cleanup();
        resolve({
          status: xhr.status,
          getHeader: (name) => xhr.getResponseHeader(name),
          text: typeof xhr.responseText === "string" ? xhr.responseText : "",
        });
      };
      xhr.onerror = () => {
        cleanup();
        reject(
          new UploadError("network", "Network error while uploading (check storage CORS settings)", {
            retryable: true,
          }),
        );
      };
      xhr.ontimeout = () => {
        cleanup();
        reject(new UploadError("timeout", "Storage request timed out", { retryable: true }));
      };
      xhr.onabort = () => {
        cleanup();
        reject(abortError());
      };

      xhr.send(req.body);
    });
  },
};
