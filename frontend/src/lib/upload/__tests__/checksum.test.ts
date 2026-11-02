import { describe, expect, it } from "vitest";
import { computeChecksum, crcOfBlob, crcUpdate, uint32ToBase64 } from "../checksum";

const enc = new TextEncoder();
const blob = (s: string) => new Blob([enc.encode(s)]);

describe("checksums", () => {
  it("matches the standard CRC32 check value", async () => {
    expect(crcUpdate(0, enc.encode("123456789"))).toBe(0xcbf43926);
    expect(await computeChecksum(blob("123456789"), "CRC32")).toBe("y/Q5Jg==");
  });

  it("matches the standard CRC32C check value", async () => {
    expect(await computeChecksum(blob("123456789"), "CRC32C")).toBe("4waSgw==");
  });

  it("matches SHA-1 and SHA-256 test vectors (base64)", async () => {
    expect(await computeChecksum(blob("abc"), "SHA1")).toBe("qZk+NkcGgWq6PiVxeFDCbJzQ2J0=");
    expect(await computeChecksum(blob("abc"), "SHA256")).toBe("ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=");
  });

  it("streams CRCs over slices with the same result as one pass", async () => {
    const data = new Uint8Array(10_007).map((_, i) => (i * 31) % 256);
    const oneShot = crcUpdate(0, data);
    expect(await crcOfBlob(new Blob([data]), undefined, 1000)).toBe(oneShot);
    expect(await crcOfBlob(new Blob([data]), undefined, 7)).toBe(oneShot);
  });

  it("is incremental", () => {
    const a = enc.encode("hello ");
    const b = enc.encode("world");
    expect(crcUpdate(crcUpdate(0, a), b)).toBe(crcUpdate(0, enc.encode("hello world")));
  });

  it("handles empty input", async () => {
    expect(await computeChecksum(new Blob([]), "CRC32")).toBe(uint32ToBase64(0));
    expect(await computeChecksum(new Blob([]), "SHA256")).toBe("47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=");
  });

  it("refuses to buffer large blobs for SHA digests", async () => {
    await expect(computeChecksum(new Blob([new Uint8Array(100)]), "SHA256", { maxDigestBytes: 10 })).rejects.toMatchObject(
      { code: "checksum" },
    );
  });
});
