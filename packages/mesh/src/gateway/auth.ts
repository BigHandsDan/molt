import { Request, Response, NextFunction } from 'express';
import { ApiKeyRegistry, OrgApiKey } from './api-keys.js';
import { RateLimiter } from './rate-limiter.js';
import { Organization, OrgRegistry } from '../federation/organization.js';

// Extend Express Request to include gateway auth info
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      org?: Organization;
      apiKey?: OrgApiKey;
    }
  }
}

/**
 * Create Express middleware that authenticates requests via Bearer token,
 * enforces rate limits, and attaches the resolved organization to the request.
 * @param apiKeyRegistry - Registry for validating API keys.
 * @param orgRegistry - Registry for resolving organizations from API keys.
 * @param rateLimiter - Rate limiter instance.
 * @returns Express middleware function.
 */
export function createAuthMiddleware(
  apiKeyRegistry: ApiKeyRegistry,
  orgRegistry: OrgRegistry,
  rateLimiter: RateLimiter
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Missing or invalid Authorization header' });
      return;
    }

    const rawKey = authHeader.slice(7); // Remove "Bearer "
    const apiKey = apiKeyRegistry.validateKey(rawKey);
    if (!apiKey) {
      res.status(401).json({ success: false, error: 'Invalid or expired API key' });
      return;
    }

    // Check rate limit
    const rateResult = rateLimiter.checkRate(apiKey.keyId, apiKey.rateLimit);
    if (!rateResult.allowed) {
      res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        resetAt: rateResult.resetAt.toISOString(),
      });
      return;
    }

    // Resolve org
    const org = orgRegistry.getOrg(apiKey.orgId);
    if (!org) {
      res.status(401).json({ success: false, error: 'Organization not found for API key' });
      return;
    }

    req.org = org;
    req.apiKey = apiKey;
    next();
  };
}
