import express from "express";
import { timingSafeEqual } from "node:crypto";
import { MoltCaptcha } from "../index.js";

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function createServer(options?: { apiKey?: string }) {
  const app = express();
  const captcha = new MoltCaptcha();

  app.use(express.json());

  // Rate limiting (simple in-memory)
  const rateLimits = new Map<string, { count: number; resetAt: number }>();
  const RATE_LIMIT = 60;
  const RATE_WINDOW = 60_000;

  app.use((req, res, next) => {
    // Skip rate limiting for health checks
    if (req.path === "/health") {
      next();
      return;
    }

    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const entry = rateLimits.get(ip);

    if (!entry || now > entry.resetAt) {
      rateLimits.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
      next();
      return;
    }

    entry.count++;
    if (entry.count > RATE_LIMIT) {
      res.status(429).json({ error: "Rate limit exceeded" });
      return;
    }
    next();
  });

  // Optional API key auth
  if (options?.apiKey) {
    app.use((req, res, next) => {
      // Skip auth for health checks
      if (req.path === "/health") {
        next();
        return;
      }

      const key = (req.headers["x-api-key"] || req.query["api_key"]) as string | undefined;
      if (!key || !safeCompare(key, options.apiKey!)) {
        res.status(401).json({ error: "Invalid API key" });
        return;
      }
      next();
    });
  }

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/challenge", (req, res) => {
    const difficulty = (req.query.difficulty as string) || "medium";
    const challenge = captcha.generate(difficulty);
    const formatted = captcha.format(challenge);
    res.json(formatted);
  });

  app.post("/verify", (req, res) => {
    const { challengeId, response } = req.body;
    if (!challengeId || !response) {
      res.status(400).json({ error: "Missing challengeId or response" });
      return;
    }
    const result = captcha.verify(challengeId, response);
    if (!result) {
      res.status(404).json({ error: "Challenge not found or already consumed" });
      return;
    }
    res.json(result);
  });

  app.get("/stats", (_req, res) => {
    res.json(captcha.getStats());
  });

  return app;
}

// Run as standalone if executed directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith("standalone.ts") ||
  process.argv[1].endsWith("standalone.js") ||
  process.argv[1].endsWith("server.js") ||
  process.argv[1].endsWith("server.cjs")
);

if (isMain) {
  const port = parseInt(process.env.PORT || "3002", 10);
  const apiKey = process.env.MOLTCAPTCHA_API_KEY;
  const app = createServer({ apiKey });
  app.listen(port, () => {
    console.log(`MoltCaptcha server running on port ${port}`);
    if (apiKey) console.log("API key authentication enabled");
  });
}
