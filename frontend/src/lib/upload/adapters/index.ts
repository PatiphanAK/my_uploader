import type { BackendProfile } from "../../config/profiles";
import type { DestinationPolicy } from "../destination";
import { xhrTransport } from "../http";
import type { UploadBackendAdapter, UploadTransport } from "../types";
import { createMockBackend } from "./mock";
import { createStandardAdapter } from "./standard";

export interface ResolvedBackend {
  adapter: UploadBackendAdapter;
  transport: UploadTransport;
  destination: DestinationPolicy;
  allowStorageAuthHeader: boolean;
}

let mockSingleton: ReturnType<typeof createMockBackend> | undefined;

/** Turn a profile into the adapter/transport pair the upload session needs. */
export function resolveBackend(profile: BackendProfile): ResolvedBackend {
  switch (profile.adapter) {
    case "mock": {
      mockSingleton ??= createMockBackend();
      return {
        adapter: mockSingleton.adapter,
        transport: mockSingleton.transport,
        destination: { allowedHosts: mockSingleton.storageHosts },
        allowStorageAuthHeader: false,
      };
    }
    case "standard": {
      if (!profile.apiBaseUrl) throw new Error(`Profile "${profile.id}" has no apiBaseUrl`);
      return {
        adapter: createStandardAdapter({ baseUrl: profile.apiBaseUrl, routes: profile.routes }),
        transport: xhrTransport,
        destination: { allowedHosts: profile.allowedUploadHosts ?? [new URL(profile.apiBaseUrl).host] },
        allowStorageAuthHeader: !!profile.allowStorageAuthHeader,
      };
    }
  }
}

export { createMockBackend } from "./mock";
export { createStandardAdapter } from "./standard";
