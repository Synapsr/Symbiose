CREATE TABLE `blood_pressure` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`external_id` text,
	`measured_at` text NOT NULL,
	`local_date` text NOT NULL,
	`systolic` integer NOT NULL,
	`diastolic` integer NOT NULL,
	`pulse` integer,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blood_pressure_user_date` ON `blood_pressure` (`user_id`,`local_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `blood_pressure_user_external` ON `blood_pressure` (`user_id`,`external_id`);