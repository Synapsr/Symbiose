CREATE TABLE `activity` (
	`user_id` text NOT NULL,
	`local_date` text NOT NULL,
	`steps` integer,
	`active_kcal` real,
	`resting_kcal` real,
	`weight_kg` real,
	`source` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `local_date`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ai_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`value` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `coach_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`suggestion` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `coach_user_created` ON `coach_messages` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `cravings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`at` text NOT NULL,
	`local_date` text NOT NULL,
	`what` text NOT NULL,
	`intensity` integer NOT NULL,
	`outcome` text DEFAULT 'pending' NOT NULL,
	`tip` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cravings_user_date` ON `cravings` (`user_id`,`local_date`);--> statement-breakpoint
CREATE TABLE `meals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`eaten_at` text NOT NULL,
	`local_date` text NOT NULL,
	`meal_type` text NOT NULL,
	`title` text NOT NULL,
	`items` text NOT NULL,
	`photo_id` text,
	`input_text` text,
	`note` text,
	`insight` text,
	`favorite` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `meals_user_date` ON `meals` (`user_id`,`local_date`);--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`profile` text,
	`plan` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);