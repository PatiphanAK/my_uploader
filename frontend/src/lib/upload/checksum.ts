import { UploadError } from "./errors";
import type { ChecksumAlgorithm } from "./types";

/**
 * Checksums for upload integrity. Output is base64 of the big-endian digest,
 * matching the S3 `x-amz-checksum-*` header format.
 *
 * CRC variants stream over the blob in fixed-size slices (bounded memory).
 * SHA variants use WebCrypto, which has no streaming API, so they read the
 * whole blob — fine for multipart parts, but capped for single-request uploads.
 */

const CRC32_POLY = 0xedb88320; // IEEE 802.3, reflected
const CRC32C_POLY = 0x82f63b78; // Castagnoli, reflected

const STREAM_SLICE = 4 * 1024 * 1024;
export const MAX_DIGEST_BYTES = 128 * 1024 * 1024;

const tables = new Map<number, Uint32Array>();

function crcTable(poly: number): Uint32Array {
  let table = tables.get(poly);
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? poly ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  tables.set(poly, table);
  return table;
}

/** Incremental CRC. Start with `crc = 0`; feed chunks in order. */
export function crcUpdate(crc: number, bytes: Uint8Array, poly = CRC32_POLY): number {
  const table = crcTable(poly);
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

export async function crcOfBlob(blob: Blob, poly = CRC32_POLY, sliceSize = STREAM_SLICE): Promise<number> {
  let crc = 0;
  for (let offset = 0; offset < blob.size; offset += sliceSize) {
    const chunk = new Uint8Array(await blob.slice(offset, offset + sliceSize).arrayBuffer());
    crc = crcUpdate(crc, chunk, poly);
  }
  return crc;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function uint32ToBase64(value: number): string {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, false);
  return bytesToBase64(bytes);
}

export function defaultChecksumHeader(algorithm: ChecksumAlgorithm): string {
  return `x-amz-checksum-${algorithm.toLowerCase()}`;
}

export async function computeChecksum(
  blob: Blob,
  algorithm: ChecksumAlgorithm,
  opts: { maxDigestBytes?: number } = {},
): Promise<string> {
  switch (algorithm) {
    case "CRC32":
      return uint32ToBase64(await crcOfBlob(blob, CRC32_POLY));
    case "CRC32C":
      return uint32ToBase64(await crcOfBlob(blob, CRC32C_POLY));
    case "SHA1":
    case "SHA256": {
      const limit = opts.maxDigestBytes ?? MAX_DIGEST_BYTES;
      if (blob.size > limit) {
        throw new UploadError(
          "checksum",
          `${algorithm} over ${blob.size} bytes would require buffering the whole file; ` +
            "use multipart or a CRC checksum for large files",
        );
      }
      const name = algorithm === "SHA1" ? "SHA-1" : "SHA-256";
      const digest = await crypto.subtle.digest(name, await blob.arrayBuffer());
      return bytesToBase64(new Uint8Array(digest));
    }
    default: {
      const never: never = algorithm;
      throw new UploadError("checksum", `Unsupported checksum algorithm: ${String(never)}`);
    }
  }
}
