import { eq, asc, sql } from 'drizzle-orm';
import { db } from './index.ts';
import { users, materials, tanks, entries } from './schema.ts';
import {
  MaterialRecord,
  TankRecord,
  TankEntryRecord,
  Point2D,
} from '../lib/tankMath.ts';
import {
  UserAccountRecord,
  INITIAL_USERS,
  INITIAL_MATERIALS,
  INITIAL_TANKS,
  INITIAL_ENTRIES,
} from './seedData.ts';

let isSeedingComplete = false;

/**
 * Ensures the PostgreSQL database is seeded with K R Agro Food Industries
 * initial users, materials, tanks, and entries on first request.
 */
export async function ensureSeededInDb(): Promise<void> {
  if (isSeedingComplete) return;
  try {
    // Automatically create tables if booting on a fresh Neon Postgres database on Render
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        uid TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'staff',
        password_hash TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS materials (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        lot_number TEXT NOT NULL,
        kg_per_litre DOUBLE PRECISION NOT NULL DEFAULT 0.78,
        color_hex TEXT NOT NULL DEFAULT '#d97706',
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tanks (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        material_id INTEGER REFERENCES materials(id) ON DELETE SET NULL,
        points_json TEXT NOT NULL,
        straight_depth_cm DOUBLE PRECISION NOT NULL DEFAULT 240,
        outlet_depth_cm DOUBLE PRECISION NOT NULL DEFAULT 40,
        correction_factor DOUBLE PRECISION NOT NULL DEFAULT 1,
        low_warning_pct DOUBLE PRECISION NOT NULL DEFAULT 15,
        high_warning_pct DOUBLE PRECISION NOT NULL DEFAULT 90,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS entries (
        id SERIAL PRIMARY KEY,
        client_entry_id TEXT NOT NULL UNIQUE,
        tank_id INTEGER NOT NULL REFERENCES tanks(id) ON DELETE CASCADE,
        material_id INTEGER REFERENCES materials(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        entry_timestamp TEXT NOT NULL,
        user_uid TEXT NOT NULL,
        user_name TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'manual',
        kg DOUBLE PRECISION NOT NULL DEFAULT 0,
        kg_per_litre DOUBLE PRECISION NOT NULL DEFAULT 0.78,
        supplier_bill_lot TEXT NOT NULL DEFAULT '',
        product_batch TEXT NOT NULL DEFAULT '',
        gap_center_cm DOUBLE PRECISION NOT NULL DEFAULT 0,
        gap_wall_cm DOUBLE PRECISION NOT NULL DEFAULT 0,
        gap_avg_cm DOUBLE PRECISION NOT NULL DEFAULT 0,
        filled_height_cm DOUBLE PRECISION NOT NULL DEFAULT 0,
        calculated_litres DOUBLE PRECISION NOT NULL DEFAULT 0,
        previous_book_kg DOUBLE PRECISION NOT NULL DEFAULT 0,
        discrepancy_kg DOUBLE PRECISION NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);

    const existingTanks = await db.select().from(tanks).limit(1);
    if (existingTanks.length > 0) {
      isSeedingComplete = true;
      return;
    }

    // 1. Seed initial users
    for (const u of INITIAL_USERS) {
      await db
        .insert(users)
        .values({
          uid: u.uid,
          email: u.email,
          name: u.name,
          role: u.role,
          passwordHash: u.passwordHash,
        })
        .onConflictDoNothing();
    }

    // 2. Seed initial materials
    for (const m of INITIAL_MATERIALS) {
      await db
        .insert(materials)
        .values({
          id: m.id,
          name: m.name,
          code: m.code,
          lotNumber: m.lotNumber,
          kgPerLitre: m.kgPerLitre,
          colorHex: m.colorHex,
        })
        .onConflictDoNothing();
    }

    // 3. Seed initial tanks
    for (const t of INITIAL_TANKS) {
      await db
        .insert(tanks)
        .values({
          id: t.id,
          name: t.name,
          materialId: t.materialId,
          pointsJson: JSON.stringify(t.points),
          straightDepthCm: t.straightDepthCm,
          outletDepthCm: t.outletDepthCm,
          correctionFactor: t.correctionFactor,
          lowWarningPercent: t.lowWarningPercent,
          highWarningPercent: t.highWarningPercent,
        })
        .onConflictDoNothing();
    }

    // 4. Seed initial entries
    for (const e of INITIAL_ENTRIES) {
      await db
        .insert(entries)
        .values({
          id: e.id,
          clientEntryId: e.clientEntryId,
          tankId: e.tankId,
          materialId: e.materialId,
          type: e.type,
          entryTimestamp: e.entryTimestamp,
          userUid: e.userUid,
          userName: e.userName,
          note: e.note,
          source: e.source,
          kg: e.kg,
          kgPerLitre: e.kgPerLitre,
          supplierBillLot: e.supplierBillLot,
          productBatch: e.productBatch,
          gapCenterCm: e.gapCenterCm,
          gapWallCm: e.gapWallCm,
          gapAvgCm: e.gapAvgCm,
          filledHeightCm: e.filledHeightCm,
          calculatedLitres: e.calculatedLitres,
          previousBookKg: e.previousBookKg,
          discrepancyKg: e.discrepancyKg,
        })
        .onConflictDoNothing();
    }

    // Advance PostgreSQL sequences past seeded IDs
    await db.execute(
      sql`SELECT setval(pg_get_serial_sequence('materials', 'id'), COALESCE((SELECT MAX(id) FROM materials), 1))`
    );
    await db.execute(
      sql`SELECT setval(pg_get_serial_sequence('tanks', 'id'), COALESCE((SELECT MAX(id) FROM tanks), 1))`
    );
    await db.execute(
      sql`SELECT setval(pg_get_serial_sequence('entries', 'id'), COALESCE((SELECT MAX(id) FROM entries), 1))`
    );
    await db.execute(
      sql`SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE((SELECT MAX(id) FROM users), 1))`
    );

    isSeedingComplete = true;
  } catch (error) {
    console.error('Database query failed in ensureSeededInDb:', error);
    throw new Error('Database seeding failed. Please try again later.', {
      cause: error,
    });
  }
}

/**
 * Upserts a user in PostgreSQL using Drizzle's onConflictDoUpdate
 * to prevent race conditions under concurrent requests.
 */
export async function getOrCreateUserInDb(
  uid: string,
  email: string,
  name: string = 'Factory Staff',
  role: 'manager' | 'staff' = 'staff',
  passwordHash: string = ''
): Promise<UserAccountRecord> {
  try {
    const cleanEmail = email.toLowerCase().trim();
    const existingByEmail = await db
      .select()
      .from(users)
      .where(eq(users.email, cleanEmail));

    if (existingByEmail.length > 0) {
      const row = existingByEmail[0];
      return {
        id: row.id,
        uid: row.uid,
        email: row.email,
        name: row.name,
        role: (row.role === 'manager' ? 'manager' : 'staff') as 'manager' | 'staff',
        passwordHash: row.passwordHash,
      };
    }

    const result = await db
      .insert(users)
      .values({
        uid,
        email: cleanEmail,
        name,
        role,
        passwordHash,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: cleanEmail,
          name,
        },
      })
      .returning();

    const row = result[0];
    return {
      id: row.id,
      uid: row.uid,
      email: row.email,
      name: row.name,
      role: (row.role === 'manager' ? 'manager' : 'staff') as 'manager' | 'staff',
      passwordHash: row.passwordHash,
    };
  } catch (error) {
    console.error('Database query failed in getOrCreateUserInDb:', error);
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function getUserByEmailFromDb(
  email: string
): Promise<UserAccountRecord | null> {
  try {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()));
    if (!rows.length) return null;
    const row = rows[0];
    return {
      id: row.id,
      uid: row.uid,
      email: row.email,
      name: row.name,
      role: (row.role === 'manager' ? 'manager' : 'staff') as 'manager' | 'staff',
      passwordHash: row.passwordHash,
    };
  } catch (error) {
    console.error('Database query failed in getUserByEmailFromDb:', error);
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function getUserByUidFromDb(
  uid: string
): Promise<UserAccountRecord | null> {
  try {
    const rows = await db.select().from(users).where(eq(users.uid, uid));
    if (!rows.length) return null;
    const row = rows[0];
    return {
      id: row.id,
      uid: row.uid,
      email: row.email,
      name: row.name,
      role: (row.role === 'manager' ? 'manager' : 'staff') as 'manager' | 'staff',
      passwordHash: row.passwordHash,
    };
  } catch (error) {
    console.error('Database query failed in getUserByUidFromDb:', error);
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function updateUserRoleInDb(
  uid: string,
  role: 'manager' | 'staff'
): Promise<UserAccountRecord | null> {
  try {
    const rows = await db
      .update(users)
      .set({ role })
      .where(eq(users.uid, uid))
      .returning();
    if (!rows.length) return null;
    const row = rows[0];
    return {
      id: row.id,
      uid: row.uid,
      email: row.email,
      name: row.name,
      role: (row.role === 'manager' ? 'manager' : 'staff') as 'manager' | 'staff',
      passwordHash: row.passwordHash,
    };
  } catch (error) {
    console.error('Database query failed in updateUserRoleInDb:', error);
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function getAllUsersFromDb(): Promise<UserAccountRecord[]> {
  try {
    const rows = await db.select().from(users).orderBy(asc(users.id));
    return rows.map((row) => ({
      id: row.id,
      uid: row.uid,
      email: row.email,
      name: row.name,
      role: (row.role === 'manager' ? 'manager' : 'staff') as 'manager' | 'staff',
      passwordHash: row.passwordHash,
    }));
  } catch (error) {
    console.error('Database query failed in getAllUsersFromDb:', error);
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function getMaterialsFromDb(): Promise<MaterialRecord[]> {
  try {
    const rows = await db.select().from(materials).orderBy(asc(materials.id));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      lotNumber: r.lotNumber,
      kgPerLitre: r.kgPerLitre,
      colorHex: r.colorHex,
    }));
  } catch (error) {
    console.error('Database query failed in getMaterialsFromDb:', error);
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function createMaterialInDb(
  data: Omit<MaterialRecord, 'id'>
): Promise<MaterialRecord> {
  try {
    const rows = await db
      .insert(materials)
      .values({
        name: data.name,
        code: data.code,
        lotNumber: data.lotNumber,
        kgPerLitre: data.kgPerLitre,
        colorHex: data.colorHex,
      })
      .returning();
    const r = rows[0];
    return {
      id: r.id,
      name: r.name,
      code: r.code,
      lotNumber: r.lotNumber,
      kgPerLitre: r.kgPerLitre,
      colorHex: r.colorHex,
    };
  } catch (error) {
    console.error('Database query failed in createMaterialInDb:', error);
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function updateMaterialInDb(
  id: number,
  data: Partial<Omit<MaterialRecord, 'id'>>
): Promise<MaterialRecord> {
  try {
    const rows = await db
      .update(materials)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.code !== undefined ? { code: data.code } : {}),
        ...(data.lotNumber !== undefined ? { lotNumber: data.lotNumber } : {}),
        ...(data.kgPerLitre !== undefined ? { kgPerLitre: data.kgPerLitre } : {}),
        ...(data.colorHex !== undefined ? { colorHex: data.colorHex } : {}),
        updatedAt: new Date(),
      })
      .where(eq(materials.id, id))
      .returning();
    const r = rows[0];
    return {
      id: r.id,
      name: r.name,
      code: r.code,
      lotNumber: r.lotNumber,
      kgPerLitre: r.kgPerLitre,
      colorHex: r.colorHex,
    };
  } catch (error) {
    console.error('Database query failed in updateMaterialInDb:', error);
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

function parsePoints(pointsJson: string): Point2D[] {
  try {
    const parsed = JSON.parse(pointsJson);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // ignore parse error
  }
  return [
    { x: 90, y: 0 },
    { x: 150, y: 0 },
    { x: 240, y: 120 },
    { x: 240, y: 420 },
    { x: 0, y: 420 },
    { x: 0, y: 120 },
  ];
}

export async function getTanksFromDb(): Promise<TankRecord[]> {
  try {
    const rows = await db.select().from(tanks).orderBy(asc(tanks.id));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      materialId: r.materialId,
      points: parsePoints(r.pointsJson),
      straightDepthCm: r.straightDepthCm,
      outletDepthCm: r.outletDepthCm,
      correctionFactor: r.correctionFactor,
      lowWarningPercent: r.lowWarningPercent,
      highWarningPercent: r.highWarningPercent,
    }));
  } catch (error) {
    console.error('Database query failed in getTanksFromDb:', error);
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function createTankInDb(
  data: Omit<TankRecord, 'id'>
): Promise<TankRecord> {
  try {
    const rows = await db
      .insert(tanks)
      .values({
        name: data.name,
        materialId: data.materialId,
        pointsJson: JSON.stringify(data.points),
        straightDepthCm: data.straightDepthCm,
        outletDepthCm: data.outletDepthCm,
        correctionFactor: data.correctionFactor,
        lowWarningPercent: data.lowWarningPercent,
        highWarningPercent: data.highWarningPercent,
      })
      .returning();
    const r = rows[0];
    return {
      id: r.id,
      name: r.name,
      materialId: r.materialId,
      points: parsePoints(r.pointsJson),
      straightDepthCm: r.straightDepthCm,
      outletDepthCm: r.outletDepthCm,
      correctionFactor: r.correctionFactor,
      lowWarningPercent: r.lowWarningPercent,
      highWarningPercent: r.highWarningPercent,
    };
  } catch (error) {
    console.error('Database query failed in createTankInDb:', error);
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function updateTankInDb(
  id: number,
  data: Partial<Omit<TankRecord, 'id'>>
): Promise<TankRecord> {
  try {
    const rows = await db
      .update(tanks)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.materialId !== undefined ? { materialId: data.materialId } : {}),
        ...(data.points !== undefined
          ? { pointsJson: JSON.stringify(data.points) }
          : {}),
        ...(data.straightDepthCm !== undefined
          ? { straightDepthCm: data.straightDepthCm }
          : {}),
        ...(data.outletDepthCm !== undefined
          ? { outletDepthCm: data.outletDepthCm }
          : {}),
        ...(data.correctionFactor !== undefined
          ? { correctionFactor: data.correctionFactor }
          : {}),
        ...(data.lowWarningPercent !== undefined
          ? { lowWarningPercent: data.lowWarningPercent }
          : {}),
        ...(data.highWarningPercent !== undefined
          ? { highWarningPercent: data.highWarningPercent }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(tanks.id, id))
      .returning();
    const r = rows[0];
    return {
      id: r.id,
      name: r.name,
      materialId: r.materialId,
      points: parsePoints(r.pointsJson),
      straightDepthCm: r.straightDepthCm,
      outletDepthCm: r.outletDepthCm,
      correctionFactor: r.correctionFactor,
      lowWarningPercent: r.lowWarningPercent,
      highWarningPercent: r.highWarningPercent,
    };
  } catch (error) {
    console.error('Database query failed in updateTankInDb:', error);
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function deleteTankInDb(id: number): Promise<void> {
  try {
    await db.delete(entries).where(eq(entries.tankId, id));
    await db.delete(tanks).where(eq(tanks.id, id));
  } catch (error) {
    console.error('Database query failed in deleteTankInDb:', error);
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function getEntriesFromDb(): Promise<TankEntryRecord[]> {
  try {
    const rows = await db.select().from(entries).orderBy(asc(entries.id));
    return rows.map((r) => ({
      id: r.id,
      clientEntryId: r.clientEntryId,
      tankId: r.tankId,
      materialId: r.materialId,
      type: r.type as 'load' | 'use' | 'reading',
      entryTimestamp: r.entryTimestamp,
      userUid: r.userUid,
      userName: r.userName,
      note: r.note,
      source: (r.source === 'sensor' ? 'sensor' : 'manual') as 'manual' | 'sensor',
      kg: r.kg,
      kgPerLitre: r.kgPerLitre,
      supplierBillLot: r.supplierBillLot,
      productBatch: r.productBatch,
      gapCenterCm: r.gapCenterCm,
      gapWallCm: r.gapWallCm,
      gapAvgCm: r.gapAvgCm,
      filledHeightCm: r.filledHeightCm,
      calculatedLitres: r.calculatedLitres,
      previousBookKg: r.previousBookKg,
      discrepancyKg: r.discrepancyKg,
    }));
  } catch (error) {
    console.error('Database query failed in getEntriesFromDb:', error);
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function createEntryInDb(
  data: Omit<TankEntryRecord, 'id'>
): Promise<TankEntryRecord> {
  try {
    const rows = await db
      .insert(entries)
      .values({
        clientEntryId: data.clientEntryId,
        tankId: data.tankId,
        materialId: data.materialId,
        type: data.type,
        entryTimestamp: data.entryTimestamp,
        userUid: data.userUid,
        userName: data.userName,
        note: data.note,
        source: data.source,
        kg: data.kg,
        kgPerLitre: data.kgPerLitre,
        supplierBillLot: data.supplierBillLot,
        productBatch: data.productBatch,
        gapCenterCm: data.gapCenterCm,
        gapWallCm: data.gapWallCm,
        gapAvgCm: data.gapAvgCm,
        filledHeightCm: data.filledHeightCm,
        calculatedLitres: data.calculatedLitres,
        previousBookKg: data.previousBookKg,
        discrepancyKg: data.discrepancyKg,
      })
      .onConflictDoUpdate({
        target: entries.clientEntryId,
        set: {
          note: data.note,
          kg: data.kg,
        },
      })
      .returning();
    const r = rows[0];
    return {
      id: r.id,
      clientEntryId: r.clientEntryId,
      tankId: r.tankId,
      materialId: r.materialId,
      type: r.type as 'load' | 'use' | 'reading',
      entryTimestamp: r.entryTimestamp,
      userUid: r.userUid,
      userName: r.userName,
      note: r.note,
      source: (r.source === 'sensor' ? 'sensor' : 'manual') as 'manual' | 'sensor',
      kg: r.kg,
      kgPerLitre: r.kgPerLitre,
      supplierBillLot: r.supplierBillLot,
      productBatch: r.productBatch,
      gapCenterCm: r.gapCenterCm,
      gapWallCm: r.gapWallCm,
      gapAvgCm: r.gapAvgCm,
      filledHeightCm: r.filledHeightCm,
      calculatedLitres: r.calculatedLitres,
      previousBookKg: r.previousBookKg,
      discrepancyKg: r.discrepancyKg,
    };
  } catch (error) {
    console.error('Database query failed in createEntryInDb:', error);
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function updateEntryInDb(
  id: number,
  data: Partial<Omit<TankEntryRecord, 'id'>>
): Promise<TankEntryRecord> {
  try {
    const rows = await db
      .update(entries)
      .set({
        ...(data.materialId !== undefined ? { materialId: data.materialId } : {}),
        ...(data.entryTimestamp !== undefined
          ? { entryTimestamp: data.entryTimestamp }
          : {}),
        ...(data.note !== undefined ? { note: data.note } : {}),
        ...(data.kg !== undefined ? { kg: data.kg } : {}),
        ...(data.kgPerLitre !== undefined ? { kgPerLitre: data.kgPerLitre } : {}),
        ...(data.supplierBillLot !== undefined
          ? { supplierBillLot: data.supplierBillLot }
          : {}),
        ...(data.productBatch !== undefined
          ? { productBatch: data.productBatch }
          : {}),
        ...(data.gapCenterCm !== undefined
          ? { gapCenterCm: data.gapCenterCm }
          : {}),
        ...(data.gapWallCm !== undefined ? { gapWallCm: data.gapWallCm } : {}),
        ...(data.gapAvgCm !== undefined ? { gapAvgCm: data.gapAvgCm } : {}),
        ...(data.filledHeightCm !== undefined
          ? { filledHeightCm: data.filledHeightCm }
          : {}),
        ...(data.calculatedLitres !== undefined
          ? { calculatedLitres: data.calculatedLitres }
          : {}),
        ...(data.previousBookKg !== undefined
          ? { previousBookKg: data.previousBookKg }
          : {}),
        ...(data.discrepancyKg !== undefined
          ? { discrepancyKg: data.discrepancyKg }
          : {}),
      })
      .where(eq(entries.id, id))
      .returning();
    const r = rows[0];
    return {
      id: r.id,
      clientEntryId: r.clientEntryId,
      tankId: r.tankId,
      materialId: r.materialId,
      type: r.type as 'load' | 'use' | 'reading',
      entryTimestamp: r.entryTimestamp,
      userUid: r.userUid,
      userName: r.userName,
      note: r.note,
      source: (r.source === 'sensor' ? 'sensor' : 'manual') as 'manual' | 'sensor',
      kg: r.kg,
      kgPerLitre: r.kgPerLitre,
      supplierBillLot: r.supplierBillLot,
      productBatch: r.productBatch,
      gapCenterCm: r.gapCenterCm,
      gapWallCm: r.gapWallCm,
      gapAvgCm: r.gapAvgCm,
      filledHeightCm: r.filledHeightCm,
      calculatedLitres: r.calculatedLitres,
      previousBookKg: r.previousBookKg,
      discrepancyKg: r.discrepancyKg,
    };
  } catch (error) {
    console.error('Database query failed in updateEntryInDb:', error);
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function deleteEntryInDb(id: number): Promise<void> {
  try {
    await db.delete(entries).where(eq(entries.id, id));
  } catch (error) {
    console.error('Database query failed in deleteEntryInDb:', error);
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}
