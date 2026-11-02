#!/usr/bin/env node
/**
 * Local mock of the Universal Upload Protocol v1 — for development only.
 *
 *   node scripts/mock-backend.mjs            # http://localhost:4010
 *   PORT=5000 MOCK_CHECKSUM=SHA256 node scripts/mock-backend.mjs
 *
 * Serves both the API (/api/...) and a fake object store (/storage/...).
 * Uploaded bytes are hashed and discarded; nothing is written to disk.
 * Any non-empty upload key is accepted except "invalid" (401) and "expired" (410).
 *
 * Env:
 *   PORT                 default 4010
 *   MOCK_CHECKSUM        CRC32 | SHA256 | SHA1 — require per-part checksums (verified for SHA*)
 *   MULTIPART_THRESHOLD  bytes, default 16 MiB
 *   POST_THRESHOLD       bytes; smaller single uploads use presigned POST, default 1 MiB
 *   MIN_PART_SIZE        bytes, default 5 MiB
 *   MAX_FILE_SIZE        bytes, default 10 GiB
 *   PROCESSING_MS        simulated processing time, default 5000
 *   ALLOWED_ORIGIN       CORS origin, default *
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4010);
const CHECKSUM = process.env.MOCK_CHECKSUM?.toUpperCase();
const MULTIPART_THRESHOLD = Number(process.env.MULTIPART_THRESHOLD ?? 16 * 1024 * 1024);
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE ?? 10 * 1024 ** 3);
const PROCESSING_MS = Number(process.env.PROCESSING_MS ?? 5000);
const ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";
const POST_THRESHOLD = Number(process.env.POST_THRESHOLD ?? 1024 * 1024);
const MIN_PART = Number(process.env.MIN_PART_SIZE ?? 5 * 1024 * 1024);
const URL_TTL_MS = 15 * 60_000;
const SECRET = randomBytes(32);

/** @type {Map<string, any>} */
const uploads = new Map();

const sign = (path, exp) => createHash("sha256").update(SECRET).update(`${path}:${exp}`).digest("hex");
const presign = (path) => {
  const exp = Date.now() + URL_TTL_MS;
  return { url: `http://localhost:${PORT}${path}?exp=${exp}&sig=${sign(path, exp)}`, expiresAt: new Date(exp).toISOString() };
};
const verify = (path, q) => {
  const exp = Number(q.get("exp"));
  const sig = Buffer.from(q.get("sig") ?? "", "hex");
  const want = Buffer.from(sign(path, exp), "hex");
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return "AccessDenied: bad signature";
  if (Date.now() > exp) return "AccessDenied: Request has expired";
  return null;
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, x-amz-checksum-crc32, x-amz-checksum-crc32c, x-amz-checksum-sha1, x-amz-checksum-sha256");
  res.setHeader("Access-Control-Expose-Headers", "ETag");
  res.setHeader("Access-Control-Max-Age", "600");
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
const apiError = (res, status, code, message) => json(res, status, { error: { code, message } });

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

/** Stream the body, hashing it; returns { size, sha256, sha1 } (base64). */
async function drain(req) {
  const h256 = createHash("sha256");
  const h1 = createHash("sha1");
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    h256.update(chunk);
    h1.update(chunk);
  }
  return { size, SHA256: h256.digest("base64"), SHA1: h1.digest("base64") };
}

function auth(req, res) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
  if (!m) return apiError(res, 401, "missing_key", "Missing upload key"), null;
  if (m[1] === "invalid") return apiError(res, 401, "invalid_key", "Upload key not recognized"), null;
  if (m[1] === "expired") return apiError(res, 410, "expired_key", "Upload key expired"), null;
  return m[1];
}

function statusOf(u) {
  if (u.state === "processing") {
    const progress = Math.min(1, (Date.now() - u.completedAt) / PROCESSING_MS);
    if (progress >= 1) u.state = "completed";
    else
      return {
        uploadId: u.id,
        state: "processing",
        processing: { stage: ["queued", "scanning", "processing"][Math.floor(progress * 3)], progress },
        pollAfterMs: 1000,
      };
  }
  if (u.state === "completed")
    return { uploadId: u.id, state: "completed", processing: { stage: "done", progress: 1 }, result: { objectKey: u.objectKey, bytes: u.received } };
  return { uploadId: u.id, state: u.state, completedParts: u.strategy === "multipart" ? partsList(u) : undefined };
}
const partsList = (u) => [...u.parts].map(([partNumber, p]) => ({ partNumber, etag: p.etag, size: p.size }));

async function api(req, res, path) {
  const key = auth(req, res);
  if (!key) return;
  const seg = path.split("/").filter(Boolean); // ["uploads", id?, action?]
  if (seg[0] !== "uploads") return apiError(res, 404, "not_found", "Unknown route");

  // POST /uploads
  if (req.method === "POST" && seg.length === 1) {
    const body = await readJson(req);
    const file = body.file ?? {};
    if (typeof file.size !== "number" || file.size < 0) return apiError(res, 400, "bad_request", "file.size required");
    if (file.size > MAX_FILE_SIZE) return apiError(res, 413, "too_large", "File too large for this key");

    if (body.resumeUploadId) {
      const prev = uploads.get(body.resumeUploadId);
      if (prev && prev.key === key && prev.state === "uploading" && prev.size === file.size && prev.strategy === "multipart") {
        return json(res, 200, {
          uploadId: prev.id,
          instructions: { strategy: "multipart", partSize: prev.partSize, resumable: true, checksum: prev.checksum, completedParts: partsList(prev) },
        });
      }
    }

    const id = `up_${randomBytes(8).toString("hex")}`;
    const strategy = file.size >= MULTIPART_THRESHOLD ? "multipart" : file.size < POST_THRESHOLD ? "post" : "put";
    const u = { id, key, size: file.size, strategy, state: "uploading", parts: new Map(), received: 0, objectKey: `mock/${id}/${String(file.name ?? "file").slice(0, 200)}` };
    uploads.set(id, u);
    console.log(`[init] ${id} ${strategy} ${file.size}B ${file.name}`);

    if (strategy === "multipart") {
      u.partSize = Math.max(MIN_PART, Math.ceil(file.size / 10_000), Number(body.client?.preferredPartSize) || 0);
      u.checksum = CHECKSUM ? { algorithm: CHECKSUM } : undefined;
      return json(res, 201, {
        uploadId: id,
        instructions: { strategy, partSize: u.partSize, totalParts: Math.max(1, Math.ceil(file.size / u.partSize)), partUrlBatchSize: 8, resumable: true, checksum: u.checksum },
      });
    }
    if (strategy === "post") {
      const { url, expiresAt } = presign(`/storage/${id}`);
      return json(res, 201, { uploadId: id, instructions: { strategy, url, fields: { key: u.objectKey }, expiresAt } });
    }
    const { url, expiresAt } = presign(`/storage/${id}`);
    u.checksum = CHECKSUM ? { algorithm: CHECKSUM } : undefined;
    return json(res, 201, { uploadId: id, instructions: { strategy, url, expiresAt, checksum: u.checksum } });
  }

  const u = uploads.get(seg[1]);
  if (!u || u.key !== key) return apiError(res, 404, "not_found", "Upload not found");

  // POST /uploads/:id/parts
  if (req.method === "POST" && seg[2] === "parts") {
    if (u.state !== "uploading") return apiError(res, 410, "gone", "Upload is no longer active");
    const body = await readJson(req);
    const parts = (body.parts ?? []).map((p) => {
      if (u.checksum && !p.checksum) throw new Error(`part ${p.partNumber} missing checksum`);
      if (p.checksum) (u.expected ??= new Map()).set(p.partNumber, p.checksum);
      return { partNumber: p.partNumber, ...presign(`/storage/${u.id}/${p.partNumber}`) };
    });
    return json(res, 200, { parts });
  }

  // POST /uploads/:id/complete
  if (req.method === "POST" && seg[2] === "complete") {
    if (u.state === "processing" || u.state === "completed") return json(res, 200, statusOf(u)); // idempotent
    if (u.state !== "uploading") return apiError(res, 410, "gone", `Upload is ${u.state}`);
    const body = await readJson(req);
    if (u.strategy === "multipart") {
      const expected = Math.max(1, Math.ceil(u.size / u.partSize));
      const parts = body.parts ?? [];
      if (parts.length !== expected) return apiError(res, 400, "missing_parts", `Expected ${expected} parts, got ${parts.length}`);
      for (const p of parts) {
        if (u.parts.get(p.partNumber)?.etag !== p.etag) return apiError(res, 400, "bad_etag", `ETag mismatch for part ${p.partNumber}`);
      }
      u.received = [...u.parts.values()].reduce((n, p) => n + p.size, 0);
    }
    if (u.received !== u.size) return apiError(res, 400, "size_mismatch", `Received ${u.received} of ${u.size} bytes`);
    u.state = "processing";
    u.completedAt = Date.now();
    console.log(`[done] ${u.id} ${u.received}B`);
    return json(res, 200, statusOf(u));
  }

  // DELETE /uploads/:id
  if (req.method === "DELETE" && seg.length === 2) {
    if (u.state === "uploading") u.state = "aborted";
    console.log(`[abort] ${u.id}`);
    return json(res, 204);
  }

  // GET /uploads/:id
  if (req.method === "GET" && seg.length === 2) return json(res, 200, statusOf(u));

  return apiError(res, 405, "method_not_allowed", "Method not allowed");
}

async function storage(req, res, path, q) {
  if (req.headers.authorization) {
    res.writeHead(400);
    return res.end("Mock storage refuses Authorization headers: API credentials must never reach storage");
  }
  const denied = verify(path, q);
  if (denied) {
    res.writeHead(403);
    return res.end(denied);
  }
  const [, , id, part] = path.split("/");
  const u = uploads.get(id);
  if (!u || u.state !== "uploading") {
    res.writeHead(403);
    return res.end("AccessDenied: upload not active");
  }

  if (req.method === "POST") {
    // Presigned POST: we do not parse multipart/form-data; count the file by Content-Length minus overhead is unreliable,
    // so trust the declared size once the body has been fully received.
    await drain(req);
    u.received = u.size;
    res.writeHead(204);
    return res.end();
  }
  if (req.method !== "PUT") {
    res.writeHead(405);
    return res.end();
  }

  const got = await drain(req);
  if (u.checksum && u.checksum.algorithm in got) {
    const header = req.headers[`x-amz-checksum-${u.checksum.algorithm.toLowerCase()}`];
    const want = part ? u.expected?.get(Number(part)) : header;
    if (!header || header !== got[u.checksum.algorithm] || (want && want !== header)) {
      res.writeHead(400);
      return res.end("BadDigest: checksum mismatch");
    }
  }
  const etag = `"${got.SHA256.slice(0, 16)}"`;
  if (part) u.parts.set(Number(part), { etag, size: got.size });
  else u.received = got.size;
  res.writeHead(200, { ETag: etag });
  res.end();
}

createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith("/api/")) return await api(req, res, url.pathname.slice(4));
    if (url.pathname.startsWith("/storage/")) return await storage(req, res, url.pathname, url.searchParams);
    res.writeHead(404);
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) apiError(res, 400, "bad_request", String(err.message ?? err));
  }
}).listen(PORT, () => {
  console.log(`Mock upload backend on http://localhost:${PORT}/api  (checksum: ${CHECKSUM ?? "none"})`);
});
