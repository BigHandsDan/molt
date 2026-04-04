import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { CatalogRegistry } from './catalog.js';

/** A service provider's response to a review. */
export interface ReviewResponse {
  body: string;
  respondedAt: string;
}

/** A review of a service listing submitted by a buyer organization. */
export interface ServiceReview {
  reviewId: string;
  listingId: string;
  reviewerOrgId: string;
  rating: number;
  title: string;
  body: string;
  traceId?: string;
  response?: ReviewResponse;
  createdAt: string;
}

interface ReviewRow {
  review_id: string;
  listing_id: string;
  reviewer_org_id: string;
  rating: number;
  title: string;
  body: string;
  trace_id: string | null;
  response_body: string | null;
  response_at: string | null;
  created_at: string;
}

/** SQLite-backed registry for service reviews with automatic catalog rating updates. */
export class ReviewRegistry {
  private db: Database.Database;
  private catalogRegistry: CatalogRegistry;

  constructor(db: Database.Database, catalogRegistry: CatalogRegistry) {
    this.db = db;
    this.catalogRegistry = catalogRegistry;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS service_reviews (
        review_id TEXT PRIMARY KEY,
        listing_id TEXT NOT NULL,
        reviewer_org_id TEXT NOT NULL,
        rating INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        trace_id TEXT,
        response_body TEXT,
        response_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(listing_id, reviewer_org_id)
      );
      CREATE INDEX IF NOT EXISTS idx_review_listing ON service_reviews(listing_id);
      CREATE INDEX IF NOT EXISTS idx_review_org ON service_reviews(reviewer_org_id);
    `);
  }

  /** Create or update a review for a listing. One review per org per listing. */
  create(review: Omit<ServiceReview, 'reviewId' | 'createdAt' | 'response'>): ServiceReview {
    if (review.rating < 1 || review.rating > 5) {
      throw new Error('Rating must be between 1 and 5');
    }

    const now = new Date().toISOString();

    // Check if an existing review exists (upsert)
    const existing = this.db
      .prepare('SELECT * FROM service_reviews WHERE listing_id = ? AND reviewer_org_id = ?')
      .get(review.listingId, review.reviewerOrgId) as ReviewRow | undefined;

    if (existing) {
      // Update existing review
      this.db
        .prepare(
          `
        UPDATE service_reviews
        SET rating = ?, title = ?, body = ?, trace_id = ?, created_at = ?
        WHERE review_id = ?
      `
        )
        .run(
          review.rating,
          review.title,
          review.body,
          review.traceId || null,
          now,
          existing.review_id
        );

      const updated = this.get(existing.review_id)!;
      this.updateCatalogRating(review.listingId);
      return updated;
    }

    // Insert new review
    const reviewId = uuidv4();
    this.db
      .prepare(
        `
      INSERT INTO service_reviews (review_id, listing_id, reviewer_org_id, rating, title, body, trace_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        reviewId,
        review.listingId,
        review.reviewerOrgId,
        review.rating,
        review.title,
        review.body,
        review.traceId || null,
        now
      );

    const created: ServiceReview = {
      reviewId,
      listingId: review.listingId,
      reviewerOrgId: review.reviewerOrgId,
      rating: review.rating,
      title: review.title,
      body: review.body,
      traceId: review.traceId,
      createdAt: now,
    };

    this.updateCatalogRating(review.listingId);
    return created;
  }

  /** Retrieve a review by ID. */
  get(reviewId: string): ServiceReview | undefined {
    const row = this.db
      .prepare('SELECT * FROM service_reviews WHERE review_id = ?')
      .get(reviewId) as ReviewRow | undefined;
    if (!row) return undefined;
    return this.rowToReview(row);
  }

  /** Get all reviews for a listing, newest first. */
  getByListing(listingId: string): ServiceReview[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM service_reviews WHERE listing_id = ? ORDER BY created_at DESC, rowid DESC'
      )
      .all(listingId) as ReviewRow[];
    return rows.map((r) => this.rowToReview(r));
  }

  /** Get all reviews submitted by an organization. */
  getByOrg(orgId: string): ServiceReview[] {
    const rows = this.db
      .prepare('SELECT * FROM service_reviews WHERE reviewer_org_id = ? ORDER BY created_at DESC')
      .all(orgId) as ReviewRow[];
    return rows.map((r) => this.rowToReview(r));
  }

  /** Add a provider response to a review. */
  addResponse(reviewId: string, body: string): ServiceReview | undefined {
    const existing = this.get(reviewId);
    if (!existing) return undefined;

    const now = new Date().toISOString();
    this.db
      .prepare(
        `
      UPDATE service_reviews SET response_body = ?, response_at = ? WHERE review_id = ?
    `
      )
      .run(body, now, reviewId);

    return this.get(reviewId);
  }

  /** Calculate the average rating and review count for a listing. */
  getAverageRating(listingId: string): { avg: number; count: number } {
    const row = this.db
      .prepare(
        'SELECT AVG(rating) as avg, COUNT(*) as count FROM service_reviews WHERE listing_id = ?'
      )
      .get(listingId) as { avg: number | null; count: number };
    return {
      avg: row.avg ?? 0,
      count: row.count,
    };
  }

  private updateCatalogRating(listingId: string): void {
    const { avg, count } = this.getAverageRating(listingId);
    this.catalogRegistry.updateRating(listingId, avg, count);
  }

  private rowToReview(row: ReviewRow): ServiceReview {
    const review: ServiceReview = {
      reviewId: row.review_id,
      listingId: row.listing_id,
      reviewerOrgId: row.reviewer_org_id,
      rating: row.rating,
      title: row.title,
      body: row.body,
      traceId: row.trace_id || undefined,
      createdAt: row.created_at,
    };
    if (row.response_body) {
      review.response = {
        body: row.response_body,
        respondedAt: row.response_at || '',
      };
    }
    return review;
  }
}
