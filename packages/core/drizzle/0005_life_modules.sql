CREATE TABLE `moods` (
	`user_id` text NOT NULL,
	`local_date` text NOT NULL,
	`at` text NOT NULL,
	`mood` integer NOT NULL,
	`note` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `local_date`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sleep_nights` (
	`user_id` text NOT NULL,
	`local_date` text NOT NULL,
	`bedtime` text NOT NULL,
	`wake_time` text NOT NULL,
	`asleep_min` integer NOT NULL,
	`in_bed_min` integer,
	`source` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `local_date`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `water_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`external_id` text,
	`at` text NOT NULL,
	`local_date` text NOT NULL,
	`ml` integer NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `water_logs_user_date` ON `water_logs` (`user_id`,`local_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `water_logs_user_external` ON `water_logs` (`user_id`,`external_id`);