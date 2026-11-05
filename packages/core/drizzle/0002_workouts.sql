CREATE TABLE `workouts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`external_id` text,
	`type` text NOT NULL,
	`started_at` text NOT NULL,
	`local_date` text NOT NULL,
	`duration_min` real NOT NULL,
	`intensity` text,
	`active_kcal` real,
	`distance_km` real,
	`avg_heart_rate` real,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workouts_user_date` ON `workouts` (`user_id`,`local_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `workouts_user_external` ON `workouts` (`user_id`,`external_id`);--> statement-breakpoint
-- Plans saved before activity guardrails existed: null means the goal-based defaults.
UPDATE `users` SET `plan` = json_set(`plan`, '$.activity', json('null')) WHERE `plan` IS NOT NULL AND json_type(`plan`, '$.activity') IS NULL;
