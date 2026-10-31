CREATE TABLE `ai_usage` (
	`id` integer PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`feature` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cache_read_tokens` integer NOT NULL,
	`cache_write_tokens` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`ok` integer NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `ai_usage_at` ON `ai_usage` (`at`);--> statement-breakpoint
ALTER TABLE `users` ADD `pending` integer DEFAULT false NOT NULL;