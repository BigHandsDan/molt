import { describe, it, expect, vi } from 'vitest';
import { createMcpMiddleware } from '../src/middleware/mcp-middleware';
import type { Request, Response } from 'express';

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    body: {},
    method: 'POST',
    path: '/',
    ...overrides,
  } as Request;
}

function mockRes(): Response & { statusCode: number; jsonData: unknown } {
  const res = {
    statusCode: 200,
    jsonData: null as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.jsonData = data;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; jsonData: unknown };
}

describe('MCP Middleware', () => {
  it('should return 401 when no authorization header is present', async () => {
    const middleware = createMcpMiddleware({
      evaluate: vi.fn(),
    });

    const req = mockReq({ body: { method: 'tools/call', params: { name: 'test' } } });
    const res = mockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should pass through when no action can be extracted', async () => {
    const middleware = createMcpMiddleware({
      evaluate: vi.fn(),
    });

    const req = mockReq({
      headers: { authorization: 'Bearer agent-token' },
      body: { foo: 'bar' },
    });
    const res = mockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should return 403 when policy evaluation denies', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      decision: 'deny',
      reasons: ['Not authorized'],
      auditId: 'audit-1',
    });

    const middleware = createMcpMiddleware({ evaluate });

    const req = mockReq({
      headers: { authorization: 'Bearer agent-token' },
      body: { method: 'tools/call', params: { name: 'dangerous_tool', arguments: {} } },
    });
    const res = mockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect((res.jsonData as Record<string, unknown>).decision).toBe('deny');
    expect(next).not.toHaveBeenCalled();
  });

  it('should pass through on allow', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      decision: 'allow',
      reasons: ['Allowed'],
      auditId: 'audit-1',
    });

    const middleware = createMcpMiddleware({ evaluate });

    const req = mockReq({
      headers: { authorization: 'Bearer agent-token' },
      body: { method: 'tools/call', params: { name: 'safe_tool', arguments: {} } },
    });
    const res = mockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as Record<string, unknown>).policyDecision).toBeDefined();
  });

  it('should handle evaluation errors', async () => {
    const evaluate = vi.fn().mockRejectedValue(new Error('Engine failure'));

    const middleware = createMcpMiddleware({ evaluate });

    const req = mockReq({
      headers: { authorization: 'Bearer agent-token' },
      body: { method: 'tools/call', params: { name: 'tool', arguments: {} } },
    });
    const res = mockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(500);
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 when verifyToken returns null', async () => {
    const verifyToken = vi.fn().mockResolvedValue(null);
    const evaluate = vi.fn();

    const middleware = createMcpMiddleware({ evaluate, verifyToken });

    const req = mockReq({
      headers: { authorization: 'Bearer bad-token' },
      body: { method: 'tools/call', params: { name: 'tool', arguments: {} } },
    });
    const res = mockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect((res.jsonData as Record<string, unknown>).error).toBe('Invalid token');
    expect(evaluate).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('should use verified agent info when verifyToken succeeds', async () => {
    const verifyToken = vi.fn().mockResolvedValue({
      agentId: 'verified-agent-123',
      verificationTier: 'moltcaptcha',
    });
    const evaluate = vi.fn().mockResolvedValue({
      decision: 'allow',
      reasons: ['OK'],
      auditId: 'audit-1',
    });

    const middleware = createMcpMiddleware({ evaluate, verifyToken });

    const req = mockReq({
      headers: { authorization: 'Bearer valid-token' },
      body: { method: 'tools/call', params: { name: 'tool', arguments: {} } },
    });
    const res = mockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(verifyToken).toHaveBeenCalledWith('valid-token');
    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({
          id: 'verified-agent-123',
          verificationTier: 'moltcaptcha',
        }),
      }),
    );
    expect(next).toHaveBeenCalled();
  });

  it('should use custom agent ID extractor', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      decision: 'allow',
      reasons: ['OK'],
      auditId: 'audit-1',
    });

    const middleware = createMcpMiddleware({
      evaluate,
      extractAgentId: (req) => (req.headers as Record<string, string>)['x-agent-id'] || null,
    });

    const req = mockReq({
      headers: { 'x-agent-id': 'custom-agent' } as Record<string, string>,
      body: { method: 'tools/call', params: { name: 'tool', arguments: {} } },
    });
    const res = mockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({ id: 'custom-agent' }),
      }),
    );
  });
});
