CREATE TABLE `weight_dismissals` (
	`user_id` text NOT NULL,
	`local_date` text NOT NULL,
	`measured_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `local_date`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
