import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import * as dotenv from 'dotenv';
import {
  requireAuth,
  AuthRequest,
  createLocalSessionToken,
} from './src/middleware/auth.ts';
import {
  ensureSeededInDb,
  getOrCreateUserInDb,
  getUserByEmailFromDb,
  getUserByUidFromDb,
  updateUserRoleInDb,
  getAllUsersFromDb,
  getMaterialsFromDb,
  createMaterialInDb,
  updateMaterialInDb,
  getTanksFromDb,
  createTankInDb,
  updateTankInDb,
  deleteTankInDb,
  getEntriesFromDb,
  createEntryInDb,
  updateEntryInDb,
  deleteEntryInDb,
} from './src/db/repository.ts';
import {
  INITIAL_USERS,
  INITIAL_MATERIALS,
  INITIAL_TANKS,
  INITIAL_ENTRIES,
  UserAccountRecord,
} from './src/db/seedData.ts';
import {
  MaterialRecord,
  TankRecord,
  TankEntryRecord,
  buildTankVolumetricProfile,
  calculateLevelReadingFromGap,
  computeTankStockSummary,
} from './src/lib/tankMath.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory mirror to guarantee zero-downtime resilience if the Cloud SQL proxy restarts
const fallbackStore: {
  users: UserAccountRecord[];
  materials: MaterialRecord[];
  tanks: TankRecord[];
  entries: TankEntryRecord[];
} = {
  users: [...INITIAL_USERS],
  materials: [...INITIAL_MATERIALS],
  tanks: [...INITIAL_TANKS],
  entries: [...INITIAL_ENTRIES],
};

async function loadStateWithFallback() {
  try {
    await ensureSeededInDb();
    const [usersList, materialsList, tanksList, entriesList] = await Promise.all([
      getAllUsersFromDb(),
      getMaterialsFromDb(),
      getTanksFromDb(),
      getEntriesFromDb(),
    ]);
    fallbackStore.users = usersList;
    fallbackStore.materials = materialsList;
    fallbackStore.tanks = tanksList;
    fallbackStore.entries = entriesList;
    return {
      users: usersList.map(({ passwordHash: _, ...u }) => u),
      materials: materialsList,
      tanks: tanksList,
      entries: entriesList,
    };
  } catch (err) {
    console.error('Fallback store used due to DB error:', err);
    return {
      users: fallbackStore.users.map(({ passwordHash: _, ...u }) => u),
      materials: fallbackStore.materials,
      tanks: fallbackStore.tanks,
      entries: fallbackStore.entries,
    };
  }
}

async function resolveCurrentUser(req: AuthRequest): Promise<{
  uid: string;
  email: string;
  name: string;
  role: 'manager' | 'staff';
}> {
  const uid = req.user?.uid || 'usr-staff-1';
  const email = (req.user?.email || 'staff@kragro.com').toLowerCase().trim();
  const defaultName =
    (req.user as { name?: string })?.name || email.split('@')[0] || 'Factory Staff';
  const tokenRole = (req.user as { role?: string })?.role;

  try {
    await ensureSeededInDb();
    const existing =
      (await getUserByUidFromDb(uid)) || (await getUserByEmailFromDb(email));
    if (existing) {
      return {
        uid: existing.uid,
        email: existing.email,
        name: existing.name,
        role: existing.role,
      };
    }
    const created = await getOrCreateUserInDb(
      uid,
      email,
      defaultName,
      tokenRole === 'manager' ? 'manager' : 'staff'
    );
    return {
      uid: created.uid,
      email: created.email,
      name: created.name,
      role: created.role,
    };
  } catch {
    const local = fallbackStore.users.find(
      (u) => u.uid === uid || u.email.toLowerCase() === email
    );
    if (local) {
      return {
        uid: local.uid,
        email: local.email,
        name: local.name,
        role: local.role,
      };
    }
    return {
      uid,
      email,
      name: defaultName,
      role: tokenRole === 'manager' ? 'manager' : 'staff',
    };
  }
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  // WebSocket Server on the same port 3000 for live multi-phone synchronization
  const wss = new WebSocketServer({ server, path: '/ws' });

  function broadcastEvent(event: string, payload: unknown) {
    const message = JSON.stringify({
      event,
      payload,
      timestamp: new Date().toISOString(),
    });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  wss.on('connection', (ws) => {
    ws.send(
      JSON.stringify({
        event: 'connected',
        payload: { connectedClients: wss.clients.size },
      })
    );
  });

  app.use(express.json({ limit: '5mb' }));

  // ---------------------------------------------------------------------------
  // 1. AUTHENTICATION ROUTES (Email/Password + Firebase Google Sign-In Sync)
  // ---------------------------------------------------------------------------
  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Please enter both email and password.' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    try {
      await ensureSeededInDb();
      const user = await getUserByEmailFromDb(cleanEmail);
      if (!user || (user.passwordHash && user.passwordHash !== password)) {
        return res
          .status(401)
          .json({ error: 'Invalid email or password. Try the demo credentials below.' });
      }
      const token = createLocalSessionToken({
        uid: user.uid,
        email: user.email,
        name: user.name,
        role: user.role,
      });
      return res.json({
        token,
        user: {
          uid: user.uid,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      });
    } catch (error) {
      console.error('Login fallback check:', error);
      const localUser = fallbackStore.users.find(
        (u) => u.email.toLowerCase() === cleanEmail
      );
      if (!localUser || (localUser.passwordHash && localUser.passwordHash !== password)) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
      const token = createLocalSessionToken({
        uid: localUser.uid,
        email: localUser.email,
        name: localUser.name,
        role: localUser.role,
      });
      return res.json({
        token,
        user: {
          uid: localUser.uid,
          email: localUser.email,
          name: localUser.name,
          role: localUser.role,
        },
      });
    }
  });

  app.post('/api/auth/register', async (req, res) => {
    const { email, password, name, role } = req.body || {};
    if (!email || !password || !name) {
      return res
        .status(400)
        .json({ error: 'Name, email, and password are required.' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const assignedRole: 'manager' | 'staff' =
      role === 'manager' ? 'manager' : 'staff';
    const uid = `usr-${Date.now()}`;

    try {
      await ensureSeededInDb();
      const existing = await getUserByEmailFromDb(cleanEmail);
      if (existing) {
        return res
          .status(400)
          .json({ error: 'An account with this email already exists.' });
      }
      const user = await getOrCreateUserInDb(
        uid,
        cleanEmail,
        String(name).trim(),
        assignedRole,
        String(password)
      );
      const token = createLocalSessionToken({
        uid: user.uid,
        email: user.email,
        name: user.name,
        role: user.role,
      });
      return res.json({
        token,
        user: {
          uid: user.uid,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      });
    } catch (error) {
      console.error('Register fallback:', error);
      const newUser: UserAccountRecord = {
        id: fallbackStore.users.length + 1,
        uid,
        email: cleanEmail,
        name: String(name).trim(),
        role: assignedRole,
        passwordHash: String(password),
      };
      fallbackStore.users.push(newUser);
      const token = createLocalSessionToken({
        uid: newUser.uid,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
      });
      return res.json({
        token,
        user: {
          uid: newUser.uid,
          email: newUser.email,
          name: newUser.name,
          role: newUser.role,
        },
      });
    }
  });

  app.post('/api/auth/sync', requireAuth, async (req: AuthRequest, res) => {
    try {
      const profile = await resolveCurrentUser(req);
      res.json({ user: profile });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to sync user';
      res.status(500).json({ error: msg });
    }
  });

  app.put('/api/users/:uid/role', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { uid } = req.params;
      const { role } = req.body || {};
      const newRole: 'manager' | 'staff' =
        role === 'manager' ? 'manager' : 'staff';
      try {
        const updated = await updateUserRoleInDb(uid, newRole);
        if (updated) {
          broadcastEvent('user:updated', { uid, role: newRole });
          return res.json({ user: updated });
        }
      } catch {
        // Fallback
      }
      const target = fallbackStore.users.find((u) => u.uid === uid);
      if (target) target.role = newRole;
      broadcastEvent('user:updated', { uid, role: newRole });
      return res.json({ user: target || { uid, role: newRole } });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to update role';
      res.status(500).json({ error: msg });
    }
  });

  // ---------------------------------------------------------------------------
  // 2. STATE & INVENTORY ROUTES
  // ---------------------------------------------------------------------------
  app.get('/api/state', requireAuth, async (req: AuthRequest, res) => {
    try {
      const [state, currentUser] = await Promise.all([
        loadStateWithFallback(),
        resolveCurrentUser(req),
      ]);
      res.json({
        ...state,
        currentUser,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to load state';
      res.status(500).json({ error: msg });
    }
  });

  // Materials CRUD (Manager)
  app.post('/api/materials', requireAuth, async (req: AuthRequest, res) => {
    const user = await resolveCurrentUser(req);
    if (user.role !== 'manager') {
      return res.status(403).json({ error: 'Only a manager can add materials.' });
    }
    const { name, code, lotNumber, kgPerLitre, colorHex } = req.body || {};
    if (!name) {
      return res.status(400).json({ error: 'Material name is required.' });
    }
    const payload = {
      name: String(name).trim(),
      code: String(code || name.slice(0, 5).toUpperCase()).trim(),
      lotNumber: String(lotNumber || 'LOT-2026-NEW').trim(),
      kgPerLitre: Number(kgPerLitre) > 0 ? Number(kgPerLitre) : 0.78,
      colorHex: String(colorHex || '#d97706'),
    };
    try {
      const created = await createMaterialInDb(payload);
      fallbackStore.materials.push(created);
      broadcastEvent('material:created', created);
      res.json({ material: created });
    } catch {
      const created: MaterialRecord = {
        id:
          fallbackStore.materials.reduce((m, x) => Math.max(m, x.id), 0) + 1,
        ...payload,
      };
      fallbackStore.materials.push(created);
      broadcastEvent('material:created', created);
      res.json({ material: created });
    }
  });

  app.put('/api/materials/:id', requireAuth, async (req: AuthRequest, res) => {
    const user = await resolveCurrentUser(req);
    if (user.role !== 'manager') {
      return res.status(403).json({ error: 'Only a manager can edit materials.' });
    }
    const id = Number(req.params.id);
    const { name, code, lotNumber, kgPerLitre, colorHex } = req.body || {};
    try {
      const updated = await updateMaterialInDb(id, {
        name,
        code,
        lotNumber,
        kgPerLitre: kgPerLitre !== undefined ? Number(kgPerLitre) : undefined,
        colorHex,
      });
      broadcastEvent('material:updated', updated);
      res.json({ material: updated });
    } catch {
      const idx = fallbackStore.materials.findIndex((m) => m.id === id);
      if (idx >= 0) {
        fallbackStore.materials[idx] = {
          ...fallbackStore.materials[idx],
          ...(name !== undefined ? { name } : {}),
          ...(code !== undefined ? { code } : {}),
          ...(lotNumber !== undefined ? { lotNumber } : {}),
          ...(kgPerLitre !== undefined ? { kgPerLitre: Number(kgPerLitre) } : {}),
          ...(colorHex !== undefined ? { colorHex } : {}),
        };
        broadcastEvent('material:updated', fallbackStore.materials[idx]);
        return res.json({ material: fallbackStore.materials[idx] });
      }
      res.status(404).json({ error: 'Material not found' });
    }
  });

  // Tanks CRUD (Manager)
  app.post('/api/tanks', requireAuth, async (req: AuthRequest, res) => {
    const user = await resolveCurrentUser(req);
    if (user.role !== 'manager') {
      return res.status(403).json({ error: 'Only a manager can add tanks.' });
    }
    const {
      name,
      materialId,
      points,
      straightDepthCm,
      outletDepthCm,
      correctionFactor,
      lowWarningPercent,
      highWarningPercent,
    } = req.body || {};
    if (!name || !Array.isArray(points) || points.length < 3) {
      return res
        .status(400)
        .json({ error: 'Tank name and at least 3 corner points are required.' });
    }
    const payload: Omit<TankRecord, 'id'> = {
      name: String(name).trim().toUpperCase(),
      materialId: materialId ? Number(materialId) : null,
      points,
      straightDepthCm: Number(straightDepthCm) || 240,
      outletDepthCm: Number(outletDepthCm) || 40,
      correctionFactor: Number(correctionFactor) || 1.0,
      lowWarningPercent:
        lowWarningPercent !== undefined ? Number(lowWarningPercent) : 15,
      highWarningPercent:
        highWarningPercent !== undefined ? Number(highWarningPercent) : 90,
    };

    try {
      const created = await createTankInDb(payload);
      fallbackStore.tanks.push(created);
      broadcastEvent('tank:created', created);
      res.json({ tank: created });
    } catch {
      const created: TankRecord = {
        id: fallbackStore.tanks.reduce((m, x) => Math.max(m, x.id), 0) + 1,
        ...payload,
      };
      fallbackStore.tanks.push(created);
      broadcastEvent('tank:created', created);
      res.json({ tank: created });
    }
  });

  app.put('/api/tanks/:id', requireAuth, async (req: AuthRequest, res) => {
    const user = await resolveCurrentUser(req);
    if (user.role !== 'manager') {
      return res.status(403).json({ error: 'Only a manager can edit tanks.' });
    }
    const id = Number(req.params.id);
    const {
      name,
      materialId,
      points,
      straightDepthCm,
      outletDepthCm,
      correctionFactor,
      lowWarningPercent,
      highWarningPercent,
    } = req.body || {};
    try {
      const updated = await updateTankInDb(id, {
        ...(name !== undefined ? { name: String(name).trim().toUpperCase() } : {}),
        ...(materialId !== undefined
          ? { materialId: materialId ? Number(materialId) : null }
          : {}),
        ...(Array.isArray(points) ? { points } : {}),
        ...(straightDepthCm !== undefined
          ? { straightDepthCm: Number(straightDepthCm) }
          : {}),
        ...(outletDepthCm !== undefined
          ? { outletDepthCm: Number(outletDepthCm) }
          : {}),
        ...(correctionFactor !== undefined
          ? { correctionFactor: Number(correctionFactor) }
          : {}),
        ...(lowWarningPercent !== undefined
          ? { lowWarningPercent: Number(lowWarningPercent) }
          : {}),
        ...(highWarningPercent !== undefined
          ? { highWarningPercent: Number(highWarningPercent) }
          : {}),
      });
      broadcastEvent('tank:updated', updated);
      res.json({ tank: updated });
    } catch {
      const idx = fallbackStore.tanks.findIndex((t) => t.id === id);
      if (idx >= 0) {
        fallbackStore.tanks[idx] = {
          ...fallbackStore.tanks[idx],
          ...(name !== undefined
            ? { name: String(name).trim().toUpperCase() }
            : {}),
          ...(materialId !== undefined
            ? { materialId: materialId ? Number(materialId) : null }
            : {}),
          ...(Array.isArray(points) ? { points } : {}),
          ...(straightDepthCm !== undefined
            ? { straightDepthCm: Number(straightDepthCm) }
            : {}),
          ...(outletDepthCm !== undefined
            ? { outletDepthCm: Number(outletDepthCm) }
            : {}),
          ...(correctionFactor !== undefined
            ? { correctionFactor: Number(correctionFactor) }
            : {}),
          ...(lowWarningPercent !== undefined
            ? { lowWarningPercent: Number(lowWarningPercent) }
            : {}),
          ...(highWarningPercent !== undefined
            ? { highWarningPercent: Number(highWarningPercent) }
            : {}),
        };
        broadcastEvent('tank:updated', fallbackStore.tanks[idx]);
        return res.json({ tank: fallbackStore.tanks[idx] });
      }
      res.status(404).json({ error: 'Tank not found' });
    }
  });

  app.delete('/api/tanks/:id', requireAuth, async (req: AuthRequest, res) => {
    const user = await resolveCurrentUser(req);
    if (user.role !== 'manager') {
      return res.status(403).json({ error: 'Only a manager can delete tanks.' });
    }
    const id = Number(req.params.id);
    try {
      await deleteTankInDb(id);
    } catch {
      // Fallback
    }
    fallbackStore.tanks = fallbackStore.tanks.filter((t) => t.id !== id);
    fallbackStore.entries = fallbackStore.entries.filter((e) => e.tankId !== id);
    broadcastEvent('tank:deleted', { id });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // 3. ENTRIES ROUTES (Staff & Manager to create; Manager only to edit/delete)
  // ---------------------------------------------------------------------------
  app.post('/api/entries', requireAuth, async (req: AuthRequest, res) => {
    const user = await resolveCurrentUser(req);
    const {
      clientEntryId,
      tankId,
      materialId,
      type,
      entryTimestamp,
      note,
      kg,
      kgPerLitre,
      supplierBillLot,
      productBatch,
      gapCenterCm,
      gapWallCm,
    } = req.body || {};

    if (!tankId || !['load', 'use', 'reading'].includes(type)) {
      return res.status(400).json({ error: 'Valid tankId and entry type are required.' });
    }

    const state = await loadStateWithFallback();
    const tank = state.tanks.find((t) => t.id === Number(tankId));
    if (!tank) {
      return res.status(404).json({ error: 'Tank not found.' });
    }

    const resolvedMaterialId =
      materialId !== undefined && materialId !== null
        ? Number(materialId)
        : tank.materialId;
    const mat =
      state.materials.find((m) => m.id === resolvedMaterialId) || null;
    const tankEntries = state.entries.filter((e) => e.tankId === tank.id);
    const currentSummary = computeTankStockSummary(tank, mat, tankEntries);

    const density =
      Number(kgPerLitre) > 0
        ? Number(kgPerLitre)
        : currentSummary.activeKgPerLitre || 0.78;

    let finalKg = Number(kg) || 0;
    let gapCenter = Number(gapCenterCm) || 0;
    let gapWall = Number(gapWallCm) || 0;
    let gapAvg = 0;
    let filledHeight = 0;
    let calcLitres = 0;
    let prevBookKg = 0;
    let discrepancy = 0;

    if (type === 'reading') {
      const calc = calculateLevelReadingFromGap(
        currentSummary.profile,
        gapCenter,
        gapWall,
        density
      );
      gapAvg = calc.gapAvgCm;
      filledHeight = calc.filledHeightCm;
      calcLitres = calc.litres;
      finalKg = calc.kg;
      prevBookKg = currentSummary.stockNowKg;
      discrepancy = Number((finalKg - prevBookKg).toFixed(1));
    }

    const entryPayload: Omit<TankEntryRecord, 'id'> = {
      clientEntryId: String(clientEntryId || `entry-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
      tankId: tank.id,
      materialId: resolvedMaterialId,
      type: type as 'load' | 'use' | 'reading',
      entryTimestamp: entryTimestamp || new Date().toISOString(),
      userUid: user.uid,
      userName: user.name,
      note: String(note || '').trim(),
      source: 'manual',
      kg: finalKg,
      kgPerLitre: density,
      supplierBillLot: String(supplierBillLot || '').trim(),
      productBatch: String(productBatch || '').trim(),
      gapCenterCm: gapCenter,
      gapWallCm: gapWall,
      gapAvgCm: gapAvg,
      filledHeightCm: filledHeight,
      calculatedLitres: calcLitres,
      previousBookKg: prevBookKg,
      discrepancyKg: discrepancy,
    };

    try {
      // If loading a material into a tank, ensure tank's assigned materialId is updated
      if (type === 'load' && resolvedMaterialId && resolvedMaterialId !== tank.materialId) {
        await updateTankInDb(tank.id, { materialId: resolvedMaterialId });
      }
      const created = await createEntryInDb(entryPayload);
      broadcastEvent('entry:created', created);
      res.json({ entry: created });
    } catch {
      const created: TankEntryRecord = {
        id: fallbackStore.entries.reduce((m, x) => Math.max(m, x.id), 0) + 1,
        ...entryPayload,
      };
      fallbackStore.entries.push(created);
      broadcastEvent('entry:created', created);
      res.json({ entry: created });
    }
  });

  // Manager-only entry correction
  app.put('/api/entries/:id', requireAuth, async (req: AuthRequest, res) => {
    const user = await resolveCurrentUser(req);
    if (user.role !== 'manager') {
      return res
        .status(403)
        .json({ error: 'Only a manager can correct or edit entries.' });
    }
    const id = Number(req.params.id);
    const state = await loadStateWithFallback();
    const existing = state.entries.find((e) => e.id === id);
    if (!existing) {
      return res.status(404).json({ error: 'Entry not found.' });
    }
    const tank = state.tanks.find((t) => t.id === existing.tankId);
    if (!tank) {
      return res.status(404).json({ error: 'Tank not found.' });
    }

    const {
      kg,
      kgPerLitre,
      supplierBillLot,
      productBatch,
      gapCenterCm,
      gapWallCm,
      note,
      entryTimestamp,
    } = req.body || {};

    const density =
      kgPerLitre !== undefined && Number(kgPerLitre) > 0
        ? Number(kgPerLitre)
        : existing.kgPerLitre;

    let patch: Partial<Omit<TankEntryRecord, 'id'>> = {
      ...(note !== undefined ? { note: String(note) } : {}),
      ...(entryTimestamp !== undefined ? { entryTimestamp } : {}),
      kgPerLitre: density,
    };

    if (existing.type === 'reading') {
      const profile = buildTankVolumetricProfile(
        tank.points,
        tank.straightDepthCm,
        tank.outletDepthCm,
        tank.correctionFactor
      );
      const cGap =
        gapCenterCm !== undefined ? Number(gapCenterCm) : existing.gapCenterCm;
      const wGap =
        gapWallCm !== undefined ? Number(gapWallCm) : existing.gapWallCm;
      const calc = calculateLevelReadingFromGap(profile, cGap, wGap, density);
      patch = {
        ...patch,
        gapCenterCm: cGap,
        gapWallCm: wGap,
        gapAvgCm: calc.gapAvgCm,
        filledHeightCm: calc.filledHeightCm,
        calculatedLitres: calc.litres,
        kg: calc.kg,
        discrepancyKg: Number((calc.kg - existing.previousBookKg).toFixed(1)),
      };
    } else {
      patch = {
        ...patch,
        ...(kg !== undefined ? { kg: Number(kg) } : {}),
        ...(supplierBillLot !== undefined
          ? { supplierBillLot: String(supplierBillLot) }
          : {}),
        ...(productBatch !== undefined
          ? { productBatch: String(productBatch) }
          : {}),
      };
    }

    try {
      const updated = await updateEntryInDb(id, patch);
      broadcastEvent('entry:updated', updated);
      res.json({ entry: updated });
    } catch {
      const idx = fallbackStore.entries.findIndex((e) => e.id === id);
      if (idx >= 0) {
        fallbackStore.entries[idx] = {
          ...fallbackStore.entries[idx],
          ...patch,
        };
        broadcastEvent('entry:updated', fallbackStore.entries[idx]);
        return res.json({ entry: fallbackStore.entries[idx] });
      }
      res.status(404).json({ error: 'Entry not found' });
    }
  });

  // Manager-only entry deletion
  app.delete('/api/entries/:id', requireAuth, async (req: AuthRequest, res) => {
    const user = await resolveCurrentUser(req);
    if (user.role !== 'manager') {
      return res
        .status(403)
        .json({ error: 'Only a manager can delete entries.' });
    }
    const id = Number(req.params.id);
    try {
      await deleteEntryInDb(id);
    } catch {
      // Fallback
    }
    fallbackStore.entries = fallbackStore.entries.filter((e) => e.id !== id);
    broadcastEvent('entry:deleted', { id });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // 4. AUTOMATIC LEVEL SENSOR WEBHOOK API (/api/sensor-reading)
  // ---------------------------------------------------------------------------
  app.post('/api/sensor-reading', async (req, res) => {
    try {
      const {
        tankName,
        tankId,
        gapCenterCm,
        gapWallCm,
        gapCm,
        kgPerLitre,
        note,
      } = req.body || {};

      const state = await loadStateWithFallback();
      const tank = state.tanks.find(
        (t) =>
          (tankId && t.id === Number(tankId)) ||
          (tankName && t.name.toUpperCase() === String(tankName).trim().toUpperCase())
      );

      if (!tank) {
        return res.status(404).json({
          error: 'Tank not found. Provide valid tankName (e.g. "A", "A1") or tankId.',
        });
      }

      const mat =
        state.materials.find((m) => m.id === tank.materialId) || null;
      const tankEntries = state.entries.filter((e) => e.tankId === tank.id);
      const currentSummary = computeTankStockSummary(tank, mat, tankEntries);

      const centerVal =
        gapCenterCm !== undefined ? Number(gapCenterCm) : Number(gapCm || 120);
      const wallVal =
        gapWallCm !== undefined ? Number(gapWallCm) : centerVal;
      const density =
        Number(kgPerLitre) > 0
          ? Number(kgPerLitre)
          : currentSummary.activeKgPerLitre || 0.78;

      const calc = calculateLevelReadingFromGap(
        currentSummary.profile,
        centerVal,
        wallVal,
        density
      );

      const prevBookKg = currentSummary.stockNowKg;
      const discrepancy = Number((calc.kg - prevBookKg).toFixed(1));

      const entryPayload: Omit<TankEntryRecord, 'id'> = {
        clientEntryId: `sensor-${tank.name}-${Date.now()}`,
        tankId: tank.id,
        materialId: tank.materialId,
        type: 'reading',
        entryTimestamp: new Date().toISOString(),
        userUid: 'sensor-gateway',
        userName: `IoT Level Sensor (${tank.name})`,
        note: String(note || 'Automated ultrasonic tank top-gap reading'),
        source: 'sensor',
        kg: calc.kg,
        kgPerLitre: density,
        supplierBillLot: '',
        productBatch: '',
        gapCenterCm: centerVal,
        gapWallCm: wallVal,
        gapAvgCm: calc.gapAvgCm,
        filledHeightCm: calc.filledHeightCm,
        calculatedLitres: calc.litres,
        previousBookKg: prevBookKg,
        discrepancyKg: discrepancy,
      };

      const created = await createEntryInDb(entryPayload);
      broadcastEvent('entry:created', created);

      return res.json({
        status: 'ok',
        tank: tank.name,
        calculation: {
          gapAvgCm: calc.gapAvgCm,
          filledHeightCm: calc.filledHeightCm,
          litres: calc.litres,
          kg: calc.kg,
          fillPercent: calc.fillPercent,
          previousBookKg: prevBookKg,
          discrepancyKg: discrepancy,
        },
        entry: created,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Sensor reading failed';
      return res.status(500).json({ error: msg });
    }
  });

  // ---------------------------------------------------------------------------
  // 5. VITE MIDDLEWARE OR PRODUCTION STATIC ASSETS
  // ---------------------------------------------------------------------------
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Tank Stock (K R Agro Food Industries) server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
