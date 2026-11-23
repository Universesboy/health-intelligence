export interface Env {
  DB: D1Database;
  COACHCHALK_DB?: D1Database;
  RAW: R2Bucket;
  INGEST_QUEUE: Queue<IngestMessage>;
  LOCAL_TIME_ZONE: string;
  AUTH_MODE: "cloudflare-access" | "dev-insecure";
  RAW_ENCRYPTION_KEY: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  COACHCHALK_WORKSPACE_ID?: string;
}

export interface IngestMessage {
  batchId: string;
}
