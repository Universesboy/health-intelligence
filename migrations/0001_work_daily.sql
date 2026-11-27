CREATE TABLE `work_daily` (
	`local_date` text PRIMARY KEY NOT NULL,
	`teaching_min` integer NOT NULL,
	`coaching_min` integer NOT NULL,
	`admin_min` integer NOT NULL,
	`travel_min` integer NOT NULL,
	`total_min` integer NOT NULL,
	`lessons` integer NOT NULL,
	`longest_teaching_block_min` integer NOT NULL,
	`schema_version` integer NOT NULL,
	`fetched_at` text NOT NULL
);
