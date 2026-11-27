CREATE TABLE `baselines` (
	`metric` text NOT NULL,
	`as_of_date` text NOT NULL,
	`window_days` integer NOT NULL,
	`median` real,
	`mad` real,
	`n` integer NOT NULL,
	`computed_at` text NOT NULL,
	PRIMARY KEY(`metric`, `as_of_date`, `window_days`)
);
--> statement-breakpoint
CREATE TABLE `coaching_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`coachchalk_lesson_id` text NOT NULL,
	`local_date` text NOT NULL,
	`start_utc` text NOT NULL,
	`duration_min` integer NOT NULL,
	`lesson_type` text NOT NULL,
	`imported_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_coaching_lesson` ON `coaching_sessions` (`coachchalk_lesson_id`);--> statement-breakpoint
CREATE INDEX `idx_coaching_date` ON `coaching_sessions` (`local_date`);--> statement-breakpoint
CREATE TABLE `daily_checkins` (
	`local_date` text PRIMARY KEY NOT NULL,
	`bedtime_local` text,
	`waketime_local` text,
	`sleep_quality` integer,
	`overall_rpe` integer,
	`coaching_intensity` integer,
	`fatigue` integer,
	`energy` integer,
	`soreness_areas` text DEFAULT '[]' NOT NULL,
	`pain_areas` text DEFAULT '[]' NOT NULL,
	`caffeine_last_local` text,
	`red_flags` text DEFAULT '[]' NOT NULL,
	`note` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_load` (
	`local_date` text PRIMARY KEY NOT NULL,
	`coaching_minutes` integer DEFAULT 0 NOT NULL,
	`coaching_load` real,
	`training_minutes` integer DEFAULT 0 NOT NULL,
	`training_load` real,
	`acute_7` real,
	`chronic_28` real,
	`computed_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_metrics` (
	`local_date` text NOT NULL,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	`unit` text NOT NULL,
	`samples` integer NOT NULL,
	`computed_at` text NOT NULL,
	PRIMARY KEY(`local_date`, `metric`)
);
--> statement-breakpoint
CREATE TABLE `ingest_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`received_at` text NOT NULL,
	`payload_sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`r2_key` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`processed_at` text,
	`records_upserted` integer,
	`records_skipped` integer,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `idx_batches_source_time` ON `ingest_batches` (`source_id`,`received_at`);--> statement-breakpoint
CREATE TABLE `job_runs` (
	`job` text NOT NULL,
	`run_key` text NOT NULL,
	`ran_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`status` text NOT NULL,
	`detail` text,
	PRIMARY KEY(`job`, `run_key`)
);
--> statement-breakpoint
CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	`unit` text NOT NULL,
	`start_utc` text NOT NULL,
	`end_utc` text,
	`utc_offset_min` integer,
	`local_date` text NOT NULL,
	`source_label` text,
	`source_id` text NOT NULL,
	`provenance` text NOT NULL,
	`confidence` real,
	`extra` text,
	`dedup_key` text NOT NULL,
	`batch_id` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_obs_dedup` ON `observations` (`dedup_key`);--> statement-breakpoint
CREATE INDEX `idx_obs_metric_date` ON `observations` (`metric`,`local_date`);--> statement-breakpoint
CREATE TABLE `sleep_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`local_date` text NOT NULL,
	`sleep_start_utc` text,
	`sleep_end_utc` text,
	`in_bed_start_utc` text,
	`in_bed_end_utc` text,
	`total_sleep_h` real,
	`in_bed_h` real,
	`core_h` real,
	`deep_h` real,
	`rem_h` real,
	`awake_h` real,
	`quality` integer,
	`source_label` text,
	`source_id` text NOT NULL,
	`provenance` text NOT NULL,
	`dedup_key` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sleep_dedup` ON `sleep_sessions` (`dedup_key`);--> statement-breakpoint
CREATE INDEX `idx_sleep_date` ON `sleep_sessions` (`local_date`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`token_sha256` text,
	`scopes` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sources_token` ON `sources` (`token_sha256`);--> statement-breakpoint
CREATE TABLE `workouts` (
	`id` text PRIMARY KEY NOT NULL,
	`external_id` text,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`start_utc` text NOT NULL,
	`end_utc` text NOT NULL,
	`local_date` text NOT NULL,
	`duration_s` integer NOT NULL,
	`active_kcal` real,
	`avg_hr` real,
	`max_hr` real,
	`rpe` integer,
	`source_label` text,
	`source_id` text NOT NULL,
	`dedup_key` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workouts_dedup` ON `workouts` (`dedup_key`);--> statement-breakpoint
CREATE INDEX `idx_workouts_date` ON `workouts` (`local_date`);