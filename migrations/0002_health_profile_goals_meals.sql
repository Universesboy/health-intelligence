CREATE TABLE `goal_history` (
	`id` text PRIMARY KEY NOT NULL,
	`primary_goal` text NOT NULL,
	`secondary_goal` text,
	`target_weight_kg` real,
	`started_on` text NOT NULL,
	`ended_on` text
);
--> statement-breakpoint
CREATE INDEX `idx_goal_started` ON `goal_history` (`started_on`);--> statement-breakpoint
CREATE TABLE `insight_snapshots` (
	`local_date` text PRIMARY KEY NOT NULL,
	`content_sha256` text NOT NULL,
	`payload` text NOT NULL,
	`engine_version` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meals` (
	`id` text PRIMARY KEY NOT NULL,
	`local_date` text NOT NULL,
	`slot` text NOT NULL,
	`description` text NOT NULL,
	`size` text,
	`protein_serving` integer,
	`kcal_estimate` real,
	`protein_g_estimate` real,
	`provenance` text DEFAULT 'user_estimate' NOT NULL,
	`entry_method` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_meals_date` ON `meals` (`local_date`);--> statement-breakpoint
CREATE TABLE `profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`birth_year` integer,
	`sex` text,
	`height_cm` real,
	`primary_goal` text,
	`secondary_goal` text,
	`target_weight_kg` real,
	`activity_level` text,
	`usual_bed_local` text,
	`usual_wake_local` text,
	`training_days_per_week` integer,
	`water_target_ml` integer,
	`protein_target_g` integer,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `daily_checkins` ADD `sleep_hours_self` real;--> statement-breakpoint
ALTER TABLE `daily_checkins` ADD `readiness` integer;--> statement-breakpoint
ALTER TABLE `daily_checkins` ADD `entry_method` text;