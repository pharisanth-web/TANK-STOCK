import { relations } from 'drizzle-orm';
import {
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// Users table: linked via Firebase Auth UID or email/password UID
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: text('role').notNull().default('staff'), // 'manager' | 'staff'
  passwordHash: text('password_hash').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow(),
});

// Materials table: e.g. Matta Rice, Raw Rice, Jaya Rice, Steam Rice
export const materials = pgTable('materials', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  lotNumber: text('lot_number').notNull(),
  kgPerLitre: doublePrecision('kg_per_litre').notNull().default(0.78),
  colorHex: text('color_hex').notNull().default('#d97706'),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Tanks table: hopper-bottom tanks A, B, C, D, A1, B1, C1, D1, E, F, G, H
export const tanks = pgTable('tanks', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  materialId: integer('material_id').references(() => materials.id),
  // JSON string of [{ x: number, y: number }] in cm (across from left, up from outlet)
  pointsJson: text('points_json').notNull(),
  straightDepthCm: doublePrecision('straight_depth_cm').notNull().default(240),
  outletDepthCm: doublePrecision('outlet_depth_cm').notNull().default(40),
  correctionFactor: doublePrecision('correction_factor').notNull().default(1.0),
  lowWarningPercent: doublePrecision('low_warning_percent').notNull().default(15),
  highWarningPercent: doublePrecision('high_warning_percent').notNull().default(90),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Entries table: 'load' | 'use' | 'reading'
export const entries = pgTable('entries', {
  id: serial('id').primaryKey(),
  clientEntryId: text('client_entry_id').notNull().unique(), // For idempotent offline sync
  tankId: integer('tank_id')
    .references(() => tanks.id)
    .notNull(),
  materialId: integer('material_id').references(() => materials.id),
  type: text('type').notNull(), // 'load' | 'use' | 'reading'
  entryTimestamp: text('entry_timestamp').notNull(), // ISO timestamp
  userUid: text('user_uid').notNull(),
  userName: text('user_name').notNull(),
  note: text('note').notNull().default(''),
  source: text('source').notNull().default('manual'), // 'manual' | 'sensor'

  // Shared numeric fields
  kg: doublePrecision('kg').notNull().default(0),
  kgPerLitre: doublePrecision('kg_per_litre').notNull().default(0.78),

  // 1. Loaded into tank fields
  supplierBillLot: text('supplier_bill_lot').notNull().default(''),

  // 2. Used for production fields
  productBatch: text('product_batch').notNull().default(''),

  // 3. Level reading fields
  gapCenterCm: doublePrecision('gap_center_cm').notNull().default(0),
  gapWallCm: doublePrecision('gap_wall_cm').notNull().default(0),
  gapAvgCm: doublePrecision('gap_avg_cm').notNull().default(0),
  filledHeightCm: doublePrecision('filled_height_cm').notNull().default(0),
  calculatedLitres: doublePrecision('calculated_litres').notNull().default(0),
  previousBookKg: doublePrecision('previous_book_kg').notNull().default(0),
  discrepancyKg: doublePrecision('discrepancy_kg').notNull().default(0),

  createdAt: timestamp('created_at').defaultNow(),
});

export const materialsRelations = relations(materials, ({ many }) => ({
  tanks: many(tanks),
  entries: many(entries),
}));

export const tanksRelations = relations(tanks, ({ one, many }) => ({
  material: one(materials, {
    fields: [tanks.materialId],
    references: [materials.id],
  }),
  entries: many(entries),
}));

export const entriesRelations = relations(entries, ({ one }) => ({
  tank: one(tanks, {
    fields: [entries.tankId],
    references: [tanks.id],
  }),
  material: one(materials, {
    fields: [entries.materialId],
    references: [materials.id],
  }),
}));
