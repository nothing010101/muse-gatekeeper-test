import { loadConfig } from "../src/config";
import { AgentHandler } from "../src/handler";
import { SeenStore } from "../src/seen";
import { SIGNATURE_HEADER } from "../src/types";

/**
 * Vercel serverless entry for POST /agent (rewritten from /agent).
 * bodyParser is off so the HMAC is computed over the exact raw bytes the
 * platform signed. A fresh handler is built per invocation; the seen-set
 * persists in /tmp across warm invocations.
 *
 * Request/response are typed structurally (no Next.js dependency) — the
 * Vercel Node runtime passes a Node http.IncomingMessage / ServerResponse.
 */
export const config = {
  api: { bodyParser: false },
};

interface VercelReq extends AsyncIterable<Buffer> {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface VercelRes {
  status(code: number): VercelRes;
  json(obj: unknown): void;
  send(body: string): void;
  setHeader(name: string, value: string): void;
}

async function readRawBody(req: VercelReq): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export default async function agent(req: VercelReq, res: VercelRes) {
  const cfg = loadConfig();
  const handler = new AgentHandler(cfg, new SeenStore(cfg.seenStorePath));

  if (req.method === "GET") {
    // Health check: works even before the HMAC secret is configured.
    // GET /agent?decisions=1 returns the persisted decision log instead
    // (read-only; no secret or task input is ever included).
    const query = new URL(req.url ?? "/agent", "http://localhost").searchParams;
    if (query.get("decisions") === "1") {
      const r = handler.decisions();
      res.status(r.status).send(r.body);
      return;
    }
    const r = handler.health();
    res.status(r.status).json(JSON.parse(r.body));
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers[SIGNATURE_HEADER];
  const result = await handler.handlePost(
    rawBody,
    Array.isArray(signature) ? signature[0] : signature,
  );
  if (result.signature) res.setHeader(SIGNATURE_HEADER, result.signature);
  res.status(result.status).send(result.body);
}
