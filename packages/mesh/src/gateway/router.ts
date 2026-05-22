import { Router as ExpressRouter, Request, Response } from 'express';
import { MoltMesh } from '../bus.js';
import { TrustTier } from '../contracts/schema.js';
import { AgentIdentity } from '../identity/types.js';
import { WebhookRegistry } from './webhooks.js';
import { paramString } from './params.js';

/** Dependencies for the federation gateway HTTP router. */
export interface GatewayDeps {
  bus: MoltMesh;
  webhookRegistry?: WebhookRegistry;
}

/**
 * Create an Express router for the federation gateway with endpoints for
 * submitting cross-org tasks, listing federated contracts, checking task status, and managing webhooks.
 * @param deps - Gateway dependencies including the MoltMesh bus instance.
 * @returns Configured Express router.
 */
export function createGatewayRouter(deps: GatewayDeps): ExpressRouter {
  const router = ExpressRouter();
  const { bus } = deps;

  // POST /submit — Submit a cross-org task
  router.post('/submit', async (req: Request, res: Response) => {
    try {
      const { contractId, version, input } = req.body;
      if (!contractId) {
        res.status(400).json({ success: false, error: 'Missing contractId' });
        return;
      }

      const org = req.org!;
      const apiKey = req.apiKey!;

      // Check scope
      if (!apiKey.scopes.includes('submit')) {
        res.status(403).json({ success: false, error: 'API key does not have submit scope' });
        return;
      }

      // Look up the contract
      const contract = bus.getContractRegistry().get(contractId, version);
      if (!contract) {
        res
          .status(404)
          .json({
            success: false,
            error: `Contract ${contractId}${version ? '@' + version : ''} not found`,
          });
        return;
      }

      // Create a caller identity from the org
      const caller: AgentIdentity = {
        agentId: `gateway-${org.orgId}`,
        name: `Gateway caller for ${org.name}`,
        description: 'Auto-generated gateway caller',
        trustTier: TrustTier.EXTERNAL_PARTNER,
        orgId: org.orgId,
        namespaceId: `${org.orgId}/default`,
        capabilities: [],
        allowedTools: [],
        metadata: { gatewayKeyId: apiKey.keyId },
        registeredAt: new Date().toISOString(),
      };

      const envelope = bus.createEnvelope(contractId, contract.version, input || {}, caller);

      const result = await bus.submit(envelope);

      res.json({
        success: true,
        data: {
          traceId: envelope.traceId,
          status: result.status,
          output: result.output,
          error: result.error,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // GET /contracts — List federated contracts visible to caller's org
  router.get('/contracts', (req: Request, res: Response) => {
    try {
      const org = req.org!;
      const apiKey = req.apiKey!;

      if (!apiKey.scopes.includes('read')) {
        res.status(403).json({ success: false, error: 'API key does not have read scope' });
        return;
      }

      const allContracts = bus.getContracts();
      const grantRegistry = bus.getGrantRegistry();

      // Filter: only federated contracts where there is a valid grant to this org
      const visible = allContracts.filter((c) => {
        if (c.visibility !== 'federated') return false;
        if (!c.ownerOrgId) return false;
        if (c.ownerOrgId === org.orgId) return true; // Own contracts always visible
        const check = grantRegistry.checkGrant(c.ownerOrgId, org.orgId, c.capability);
        return check.valid;
      });

      res.json({ success: true, data: visible });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // GET /status/:traceId — Check status of a submitted task
  router.get('/status/:traceId', (req: Request, res: Response) => {
    try {
      const org = req.org!;
      const apiKey = req.apiKey!;

      if (!apiKey.scopes.includes('read')) {
        res.status(403).json({ success: false, error: 'API key does not have read scope' });
        return;
      }

      const events = bus.getTrace(paramString(req.params.traceId));
      if (events.length === 0) {
        res.status(404).json({ success: false, error: 'Trace not found' });
        return;
      }

      // Check ownership: the ingress event should have the caller's org
      const ingressEvent = events.find((e) => e.eventType === 'ingress');
      const callerAgentId = ingressEvent?.data?.agentId as string | undefined;
      if (
        callerAgentId &&
        !callerAgentId.includes(org.orgId) &&
        callerAgentId !== `gateway-${org.orgId}`
      ) {
        res
          .status(403)
          .json({ success: false, error: 'Trace does not belong to your organization' });
        return;
      }

      // Build status from events
      const responseEvent = events.find((e) => e.eventType === 'response');
      const errorEvent = events.find((e) => e.eventType === 'error');

      const status = errorEvent ? 'failure' : responseEvent ? 'completed' : 'in_progress';
      const output = responseEvent?.data?.output;
      const error = errorEvent?.data?.error || responseEvent?.data?.error;

      res.json({
        success: true,
        data: {
          traceId: paramString(req.params.traceId),
          status,
          output,
          error,
          eventCount: events.length,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // POST /webhooks — Register a webhook
  router.post('/webhooks', (req: Request, res: Response) => {
    try {
      const org = req.org!;
      const { url, events } = req.body;

      if (!url) {
        res.status(400).json({ success: false, error: 'Missing url' });
        return;
      }

      if (!deps.webhookRegistry) {
        res.status(501).json({ success: false, error: 'Webhooks not configured' });
        return;
      }

      const webhook = deps.webhookRegistry.register(
        org.orgId,
        url,
        events || ['task.completed', 'task.failed']
      );
      res.json({ success: true, data: webhook });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // GET /webhooks — List webhooks for caller's org
  router.get('/webhooks', (req: Request, res: Response) => {
    try {
      const org = req.org!;

      if (!deps.webhookRegistry) {
        res.status(501).json({ success: false, error: 'Webhooks not configured' });
        return;
      }

      const webhooks = deps.webhookRegistry.getWebhooks(org.orgId);
      res.json({ success: true, data: webhooks });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /webhooks/:id — Delete a webhook
  router.delete('/webhooks/:id', (req: Request, res: Response) => {
    try {
      if (!deps.webhookRegistry) {
        res.status(501).json({ success: false, error: 'Webhooks not configured' });
        return;
      }

      const deleted = deps.webhookRegistry.deleteWebhook(paramString(req.params.id));
      if (!deleted) {
        res.status(404).json({ success: false, error: 'Webhook not found' });
        return;
      }

      res.json({ success: true, data: { deleted: true } });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  return router;
}
