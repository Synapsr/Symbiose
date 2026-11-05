PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cravings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`at` text NOT NULL,
	`local_date` text NOT NULL,
	`what` text NOT NULL,
	`intensity` integer,
	`outcome` text DEFAULT 'pending' NOT NULL,
	`tip` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_cravings`("id", "user_id", "at", "local_date", "what", "intensity", "outcome", "tip", "created_at") SELECT "id", "user_id", "at", "local_date", "what", "intensity", "outcome", "tip", "created_at" FROM `cravings`;--> statement-breakpoint
DROP TABLE `cravings`;--> statement-breakpoint
ALTER TABLE `__new_cravings` RENAME TO `cravings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `cravings_user_date` ON `cravings` (`user_id`,`local_date`);