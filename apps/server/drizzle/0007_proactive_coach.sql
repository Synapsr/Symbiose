CREATE TABLE `vitals` (
	`user_id` text NOT NULL,
	`local_date` text NOT NULL,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	`samples` integer DEFAULT 1 NOT NULL,
	`source` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `local_date`, `metric`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `coach_messages` ADD `kind` text;--> statement-breakpoint
ALTER TABLE `coach_messages` ADD `local_date` text;--> statement-breakpoint
CREATE UNIQUE INDEX `coach_user_kind_date` ON `coach_messages` (`user_id`,`kind`,`local_date`);