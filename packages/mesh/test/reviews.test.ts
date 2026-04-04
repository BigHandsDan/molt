import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ReviewRegistry } from '../src/exchange/reviews.js';
import {
  CatalogRegistry,
  ServiceCategory,
  ServiceListing,
  ServicePricing,
  ServiceSLA,
} from '../src/exchange/catalog.js';

function makePricing(overrides: Partial<ServicePricing> = {}): ServicePricing {
  return {
    model: 'per_request',
    currency: 'credits',
    perRequestCost: 10,
    ...overrides,
  };
}

function makeSLA(overrides: Partial<ServiceSLA> = {}): ServiceSLA {
  return {
    maxLatencyMs: 5000,
    availabilityPct: 99.5,
    maxConcurrent: 10,
    supportTier: 'standard',
    ...overrides,
  };
}

function makeListing(overrides: Partial<ServiceListing> = {}): ServiceListing {
  return {
    listingId: 'listing-1',
    orgId: 'acme',
    name: 'Test Service',
    description: 'A test service',
    category: ServiceCategory.RESEARCH,
    capabilities: ['research'],
    contractIds: [],
    pricing: makePricing(),
    sla: makeSLA(),
    tags: ['test'],
    status: 'published',
    version: '1.0.0',
    metadata: {},
    ratingAvg: 0,
    ratingCount: 0,
    usageCount: 0,
    ...overrides,
  };
}

describe('ReviewRegistry', () => {
  let db: Database.Database;
  let catalog: CatalogRegistry;
  let reviews: ReviewRegistry;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    catalog = new CatalogRegistry(db);
    reviews = new ReviewRegistry(db, catalog);

    // Publish a listing for reviews
    catalog.publish(makeListing());
  });

  afterEach(() => {
    db.close();
  });

  it('should create a review and retrieve it', () => {
    const review = reviews.create({
      listingId: 'listing-1',
      reviewerOrgId: 'org-buyer',
      rating: 4,
      title: 'Great service',
      body: 'Works well for research tasks',
    });

    expect(review.reviewId).toBeTruthy();
    expect(review.listingId).toBe('listing-1');
    expect(review.reviewerOrgId).toBe('org-buyer');
    expect(review.rating).toBe(4);
    expect(review.title).toBe('Great service');
    expect(review.body).toBe('Works well for research tasks');
    expect(review.createdAt).toBeTruthy();

    const fetched = reviews.get(review.reviewId);
    expect(fetched).toBeDefined();
    expect(fetched!.rating).toBe(4);
  });

  it('should reject rating below 1', () => {
    expect(() =>
      reviews.create({
        listingId: 'listing-1',
        reviewerOrgId: 'org-buyer',
        rating: 0,
        title: 'Bad rating',
        body: 'This should fail',
      })
    ).toThrow('Rating must be between 1 and 5');
  });

  it('should reject rating above 5', () => {
    expect(() =>
      reviews.create({
        listingId: 'listing-1',
        reviewerOrgId: 'org-buyer',
        rating: 6,
        title: 'Too high',
        body: 'This should fail',
      })
    ).toThrow('Rating must be between 1 and 5');
  });

  it('should enforce one review per org per listing (upsert)', () => {
    const review1 = reviews.create({
      listingId: 'listing-1',
      reviewerOrgId: 'org-buyer',
      rating: 3,
      title: 'First review',
      body: 'Initial thoughts',
    });

    const review2 = reviews.create({
      listingId: 'listing-1',
      reviewerOrgId: 'org-buyer',
      rating: 5,
      title: 'Updated review',
      body: 'Changed my mind',
    });

    // Should update the existing review, not create a new one
    expect(review2.reviewId).toBe(review1.reviewId);
    expect(review2.rating).toBe(5);
    expect(review2.title).toBe('Updated review');

    // Only one review for this listing+org
    const listingReviews = reviews.getByListing('listing-1');
    expect(listingReviews).toHaveLength(1);
  });

  it('should allow different orgs to review the same listing', () => {
    reviews.create({
      listingId: 'listing-1',
      reviewerOrgId: 'org-1',
      rating: 4,
      title: 'Org 1 review',
      body: 'Good',
    });

    reviews.create({
      listingId: 'listing-1',
      reviewerOrgId: 'org-2',
      rating: 5,
      title: 'Org 2 review',
      body: 'Excellent',
    });

    const listingReviews = reviews.getByListing('listing-1');
    expect(listingReviews).toHaveLength(2);
  });

  it('should calculate average rating', () => {
    reviews.create({
      listingId: 'listing-1',
      reviewerOrgId: 'org-1',
      rating: 3,
      title: 'Review 1',
      body: 'Average',
    });

    reviews.create({
      listingId: 'listing-1',
      reviewerOrgId: 'org-2',
      rating: 5,
      title: 'Review 2',
      body: 'Excellent',
    });

    const { avg, count } = reviews.getAverageRating('listing-1');
    expect(avg).toBe(4);
    expect(count).toBe(2);
  });

  it('should return zero average for listing with no reviews', () => {
    const { avg, count } = reviews.getAverageRating('listing-1');
    expect(avg).toBe(0);
    expect(count).toBe(0);
  });

  it('should add provider response to a review', () => {
    const review = reviews.create({
      listingId: 'listing-1',
      reviewerOrgId: 'org-buyer',
      rating: 4,
      title: 'Great service',
      body: 'Works well',
    });

    const updated = reviews.addResponse(review.reviewId, 'Thank you for your feedback!');
    expect(updated).toBeDefined();
    expect(updated!.response).toBeDefined();
    expect(updated!.response!.body).toBe('Thank you for your feedback!');
    expect(updated!.response!.respondedAt).toBeTruthy();
  });

  it('should return undefined when adding response to nonexistent review', () => {
    const result = reviews.addResponse('nonexistent', 'Hello');
    expect(result).toBeUndefined();
  });

  it('should get reviews by listing ordered newest first', () => {
    reviews.create({
      listingId: 'listing-1',
      reviewerOrgId: 'org-1',
      rating: 3,
      title: 'First',
      body: 'Older',
    });

    // Small delay to ensure different timestamps
    reviews.create({
      listingId: 'listing-1',
      reviewerOrgId: 'org-2',
      rating: 5,
      title: 'Second',
      body: 'Newer',
    });

    const listingReviews = reviews.getByListing('listing-1');
    expect(listingReviews).toHaveLength(2);
    // Newest first — the second review should come first
    expect(listingReviews[0].reviewerOrgId).toBe('org-2');
  });

  it('should get reviews by org', () => {
    reviews.create({
      listingId: 'listing-1',
      reviewerOrgId: 'org-1',
      rating: 4,
      title: 'Review',
      body: 'Body',
    });

    // Create another listing
    catalog.publish(makeListing({ listingId: 'listing-2', name: 'Service 2' }));
    reviews.create({
      listingId: 'listing-2',
      reviewerOrgId: 'org-1',
      rating: 5,
      title: 'Another review',
      body: 'Another body',
    });

    const orgReviews = reviews.getByOrg('org-1');
    expect(orgReviews).toHaveLength(2);
  });

  it('should update catalog listing rating after review', () => {
    reviews.create({
      listingId: 'listing-1',
      reviewerOrgId: 'org-1',
      rating: 4,
      title: 'Good',
      body: 'Good service',
    });

    const listing = catalog.get('listing-1')!;
    expect(listing.ratingAvg).toBe(4);
    expect(listing.ratingCount).toBe(1);
  });

  it('should update catalog rating after multiple reviews', () => {
    reviews.create({
      listingId: 'listing-1',
      reviewerOrgId: 'org-1',
      rating: 2,
      title: 'Bad',
      body: 'Bad service',
    });

    reviews.create({
      listingId: 'listing-1',
      reviewerOrgId: 'org-2',
      rating: 4,
      title: 'Good',
      body: 'Good service',
    });

    const listing = catalog.get('listing-1')!;
    expect(listing.ratingAvg).toBe(3);
    expect(listing.ratingCount).toBe(2);
  });

  it('should include traceId when provided', () => {
    const review = reviews.create({
      listingId: 'listing-1',
      reviewerOrgId: 'org-buyer',
      rating: 5,
      title: 'Excellent',
      body: 'Tested via trace',
      traceId: 'trace-abc-123',
    });

    expect(review.traceId).toBe('trace-abc-123');
    const fetched = reviews.get(review.reviewId)!;
    expect(fetched.traceId).toBe('trace-abc-123');
  });

  it('should return undefined for nonexistent review', () => {
    expect(reviews.get('nonexistent')).toBeUndefined();
  });

  it('should update catalog rating when review is upserted', () => {
    reviews.create({
      listingId: 'listing-1',
      reviewerOrgId: 'org-1',
      rating: 2,
      title: 'Bad',
      body: 'Bad service',
    });

    let listing = catalog.get('listing-1')!;
    expect(listing.ratingAvg).toBe(2);

    // Update the review
    reviews.create({
      listingId: 'listing-1',
      reviewerOrgId: 'org-1',
      rating: 5,
      title: 'Actually great',
      body: 'Changed my mind',
    });

    listing = catalog.get('listing-1')!;
    expect(listing.ratingAvg).toBe(5);
    expect(listing.ratingCount).toBe(1);
  });
});
