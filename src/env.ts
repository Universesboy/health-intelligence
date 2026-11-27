import type { CoachchalkWorkFeed } from "./jobs/coachchalk";

export interface Env {
  DB: D1Database;
  /** Service binding to Coachchalk (`coachos`, entrypoint HealthWorkFeed). */
  COACHCHALK_WORK?: CoachchalkWorkFeed;
  RAW: R2Bucket;
  INGEST_QUEUE: Queue<IngestMessage>;
  LOCAL_TIME_ZONE: string;
  AUTH_MODE: "cloudflare-access" | "dev-insecure";
  RAW_ENCRYPTION_KEY: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  COACHCHALK_WORKSPACE_ID?: string;
  /** Optional Cloudflare Access service token for /ingest/*, only if that path is still behind Service Auth. */
  HAE_ACCESS_CLIENT_ID?: string;
  HAE_ACCESS_CLIENT_SECRET?: string;
}

export interface IngestMessage {
  batchId: string;
}
