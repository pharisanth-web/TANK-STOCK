CREATE TABLE "entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_entry_id" text NOT NULL,
	"tank_id" integer NOT NULL,
	"material_id" integer,
	"type" text NOT NULL,
	"entry_timestamp" text NOT NULL,
	"user_uid" text NOT NULL,
	"user_name" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"kg" double precision DEFAULT 0 NOT NULL,
	"kg_per_litre" double precision DEFAULT 0.78 NOT NULL,
	"supplier_bill_lot" text DEFAULT '' NOT NULL,
	"product_batch" text DEFAULT '' NOT NULL,
	"gap_center_cm" double precision DEFAULT 0 NOT NULL,
	"gap_wall_cm" double precision DEFAULT 0 NOT NULL,
	"gap_avg_cm" double precision DEFAULT 0 NOT NULL,
	"filled_height_cm" double precision DEFAULT 0 NOT NULL,
	"calculated_litres" double precision DEFAULT 0 NOT NULL,
	"previous_book_kg" double precision DEFAULT 0 NOT NULL,
	"discrepancy_kg" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "entries_client_entry_id_unique" UNIQUE("client_entry_id")
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"lot_number" text NOT NULL,
	"kg_per_litre" double precision DEFAULT 0.78 NOT NULL,
	"color_hex" text DEFAULT '#d97706' NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tanks" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"material_id" integer,
	"points_json" text NOT NULL,
	"straight_depth_cm" double precision DEFAULT 240 NOT NULL,
	"outlet_depth_cm" double precision DEFAULT 40 NOT NULL,
	"correction_factor" double precision DEFAULT 1 NOT NULL,
	"low_warning_percent" double precision DEFAULT 15 NOT NULL,
	"high_warning_percent" double precision DEFAULT 90 NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "tanks_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"uid" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"password_hash" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_uid_unique" UNIQUE("uid"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_tank_id_tanks_id_fk" FOREIGN KEY ("tank_id") REFERENCES "public"."tanks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tanks" ADD CONSTRAINT "tanks_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;