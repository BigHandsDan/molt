import { Router as ExpressRouter, Request, Response } from 'express';
import { MoltMesh } from '../bus.js';
import { TrustTier } from '../contracts/schema.js';
import { AgentIdentity } from '../identity/types.js';
import { InsufficientBalanceError } from '../errors.js';
import { paramString } from '../gateway/params.js';

/** Dependencies for the exchange HTTP router. */
export interface ExchangeRouterDeps {
  bus: MoltMesh;
}

/**
 * Create an Express router for the service exchange with endpoints for catalog browsing,
 * service invocation, subscriptions, billing, and reviews.
 * @param deps - Exchange dependencies including the MoltMesh bus instance.
 * @returns Configured Express router.
 */
export function createExchangeRouter(deps: ExchangeRouterDeps): ExpressRouter {
  const router = ExpressRouter();
  const { bus } = deps;

  // --- Catalog endpoints ---

  // GET /catalog/categories — Categories with counts (must be before /:listingId)
  router.get('/catalog/categories', (_req: Request, res: Response) => {
    try {
      const categories = bus.getCatalogRegistry().getCategories();
      res.json({ success: true, data: categories });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // GET /catalog/:listingId — Service detail with reviews
  router.get('/catalog/:listingId', (req: Request, res: Response) => {
    try {
      const listing = bus.getService(paramString(req.params.listingId));
      if (!listing) {
        res.status(404).json({ success: false, error: 'Listing not found' });
        return;
      }
      const reviews = bus.getReviews(paramString(req.params.listingId));
      res.json({ success: true, data: { ...listing, reviews } });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // GET /catalog — Browse published services
  router.get('/catalog', (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string) || '';
      const category = req.query.category as string | undefined;
      const pricingModel = req.query.pricingModel as string | undefined;
      const sortParam = (req.query.sort as string) || 'newest';
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const sortMap: Record<string, 'newest' | 'usage' | 'relevance'> = {
        newest: 'newest',
        popular: 'usage',
        rating: 'usage', // closest available sort
        relevance: 'relevance',
      };

      const listings = bus.searchCatalog(q, {
        category: category as any,
        pricingModel,
        status: 'published',
      });

      // Sort
      const sortBy = sortMap[sortParam] || 'newest';
      if (sortBy === 'usage') {
        listings.sort((a, b) => b.usageCount - a.usageCount);
      } else if (sortBy === 'newest') {
        listings.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
      }

      // Paginate
      const paginated = listings.slice(offset, offset + limit);
      res.json({ success: true, data: paginated, total: listings.length });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // --- Invoke endpoint ---
  // POST /invoke/:listingId — Invoke a service by listing ID
  router.post('/invoke/:listingId', async (req: Request, res: Response) => {
    try {
      const org = req.org!;
      const listing = bus.getService(paramString(req.params.listingId));
      if (!listing) {
        res.status(404).json({ success: false, error: 'Listing not found' });
        return;
      }

      const { input } = req.body;
      const subscriptionRegistry = bus.getSubscriptionRegistry();
      const billingEngine = bus.getBillingEngine();

      let cost = 0;
      const activeSub = subscriptionRegistry.getActive(org.orgId, listing.listingId);

      if (activeSub) {
        // Check overage
        if (subscriptionRegistry.isOverage(activeSub.subscriptionId)) {
          cost = activeSub.overageRate;
        }
        // If within quota, no charge
      } else {
        // Per-request cost
        cost = billingEngine.calculateCost(listing, { inputTokens: 0, outputTokens: 0 });
      }

      // Verify credit balance if there's a cost
      if (cost > 0) {
        const balance = billingEngine.getBalance(org.orgId);
        if (balance < cost) {
          res.status(402).json({
            success: false,
            error: `Insufficient balance: has ${balance} credits, needs ${cost}`,
          });
          return;
        }
      }

      // Resolve contracts and find target agent
      const contractId = listing.contractIds[0];
      if (!contractId) {
        res.status(400).json({ success: false, error: 'Listing has no associated contracts' });
        return;
      }

      const contract = bus.getContractRegistry().get(contractId);
      if (!contract) {
        res.status(404).json({ success: false, error: `Contract ${contractId} not found` });
        return;
      }

      // Create caller identity
      const caller: AgentIdentity = {
        agentId: `exchange-${org.orgId}`,
        name: `Exchange caller for ${org.name}`,
        description: 'Auto-generated exchange caller',
        trustTier: TrustTier.EXTERNAL_PARTNER,
        orgId: org.orgId,
        namespaceId: `${org.orgId}/default`,
        capabilities: [],
        allowedTools: [],
        metadata: { exchangeListingId: listing.listingId },
        registeredAt: new Date().toISOString(),
      };

      const envelope = bus.createEnvelope(contractId, contract.version, input || {}, caller);

      const result = await bus.submit(envelope);

      if (result.status === 'success') {
        // Charge credits on success
        if (cost > 0) {
          billingEngine.chargeForUsage(
            envelope.traceId,
            org.orgId,
            listing.orgId,
            cost,
            listing.listingId
          );
        }

        // Increment usage counters
        bus.getCatalogRegistry().incrementUsage(listing.listingId);
        if (activeSub) {
          subscriptionRegistry.incrementUsage(activeSub.subscriptionId);
        }
      }

      res.json({
        success: true,
        data: {
          traceId: envelope.traceId,
          status: result.status,
          output: result.output,
          cost,
        },
      });
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        res.status(402).json({ success: false, error: err.message });
        return;
      }
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // --- Subscription endpoints ---

  // POST /subscribe/:listingId — Subscribe to a service
  router.post('/subscribe/:listingId', (req: Request, res: Response) => {
    try {
      const org = req.org!;
      const { plan } = req.body;
      if (!plan || !['daily', 'weekly', 'monthly'].includes(plan)) {
        res
          .status(400)
          .json({ success: false, error: 'Invalid plan. Must be daily, weekly, or monthly.' });
        return;
      }

      const subscription = bus.subscribe(org.orgId, paramString(req.params.listingId), plan);
      res.json({ success: true, data: subscription });
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        res.status(402).json({ success: false, error: err.message });
        return;
      }
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // GET /subscriptions — My active subscriptions
  router.get('/subscriptions', (req: Request, res: Response) => {
    try {
      const org = req.org!;
      const subs = bus.getSubscriptions(org.orgId);
      res.json({ success: true, data: subs });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /subscriptions/:subscriptionId — Cancel subscription
  router.delete('/subscriptions/:subscriptionId', (req: Request, res: Response) => {
    try {
      const result = bus.cancelSubscription(paramString(req.params.subscriptionId), true);
      if (!result) {
        res.status(404).json({ success: false, error: 'Subscription not found' });
        return;
      }
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // --- Billing endpoints ---

  // GET /billing/balance — My credit balance
  router.get('/billing/balance', (req: Request, res: Response) => {
    try {
      const org = req.org!;
      const balance = bus.getBalance(org.orgId);
      res.json({ success: true, data: { orgId: org.orgId, balance } });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // GET /billing/transactions — My transactions
  router.get('/billing/transactions', (req: Request, res: Response) => {
    try {
      const org = req.org!;
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const type = req.query.type as string | undefined;

      const transactions = bus.getBillingEngine().getTransactions(org.orgId, {
        limit,
        offset,
        type: type as any,
      });
      res.json({ success: true, data: transactions });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // GET /billing/earnings — My earnings as provider
  router.get('/billing/earnings', (req: Request, res: Response) => {
    try {
      const org = req.org!;
      const earnings = bus.getEarnings(org.orgId);
      res.json({ success: true, data: earnings });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // POST /billing/topup — Add credits (stub)
  router.post('/billing/topup', (req: Request, res: Response) => {
    try {
      const org = req.org!;
      const { amount } = req.body;
      if (typeof amount !== 'number' || amount <= 0) {
        res.status(400).json({ success: false, error: 'Invalid amount' });
        return;
      }

      const txn = bus.addCredits(org.orgId, amount, 'topup');
      res.json({ success: true, data: txn });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // --- Review endpoints ---

  // POST /reviews — Submit review
  router.post('/reviews', (req: Request, res: Response) => {
    try {
      const org = req.org!;
      const { listingId, rating, title, body, traceId } = req.body;
      if (!listingId || !rating || !title || !body) {
        res
          .status(400)
          .json({
            success: false,
            error: 'Missing required fields: listingId, rating, title, body',
          });
        return;
      }

      const review = bus.submitReview({
        listingId,
        reviewerOrgId: org.orgId,
        rating,
        title,
        body,
        traceId,
      });
      res.json({ success: true, data: review });
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  });

  // GET /reviews/:listingId — Reviews for a listing
  router.get('/reviews/:listingId', (req: Request, res: Response) => {
    try {
      const reviews = bus.getReviews(paramString(req.params.listingId));
      res.json({ success: true, data: reviews });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // POST /reviews/:reviewId/respond — Provider responds to review
  router.post('/reviews/:reviewId/respond', (req: Request, res: Response) => {
    try {
      const { body } = req.body;
      if (!body) {
        res.status(400).json({ success: false, error: 'Missing response body' });
        return;
      }

      const review = bus.respondToReview(paramString(req.params.reviewId), body);
      if (!review) {
        res.status(404).json({ success: false, error: 'Review not found' });
        return;
      }
      res.json({ success: true, data: review });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  return router;
}
