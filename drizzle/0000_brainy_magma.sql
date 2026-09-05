CREATE TABLE `guides` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`data` text NOT NULL,
	`created` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_guides_user_created` ON `guides` (`user_id`,`created`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`payload` text NOT NULL,
	`provider_id` text,
	`research` text,
	`sources` text,
	`result` text,
	`error` text,
	`created` integer NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_user_created` ON `jobs` (`user_id`,`created`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL
);
