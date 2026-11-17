import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  MaterialRecord,
  TankRecord,
  TankEntryRecord,
  TankStockSummary,
  computeTankStockSummary,
  calculateLevelReadingFromGap,
} from './lib/tankMath.ts';
import {
  INITIAL_MATERIALS,
  INITIAL_TANKS,
  INITIAL_ENTRIES,
} from './db/seedData.ts';
import {
  auth,
  googleAuthProvider,
  signInWithPopup,
} from './lib/firebase.ts';
import { useOnlineStatus } from './hooks/usePWAInstall.ts';
import { PWAInstallButton } from './components/PWAInstallButton.tsx';
import { Tank2DCrossSection } from './components/Tank2DCrossSection.tsx';
import { Tank3DViewport } from './components/Tank3DViewport.tsx';
import { TankGeometryEditor } from './components/TankGeometryEditor.tsx';
import { EntryModal } from './components/EntryModal.tsx';
import { ReportsView } from './components/ReportsView.tsx';
import { DeployAndSensorView } from './components/DeployAndSensorView.tsx';
import {
  ArrowDownToLine,
  Cog,
  Ruler,
  AlertTriangle,
  WifiOff,
  RefreshCw,
  LogOut,
  Plus,
  Edit3,
  Trash2,
  ArrowLeft,
  Box,
  LayoutGrid,
  FileSpreadsheet,
  Sliders,
  Radio,
  UserCheck,
  Shield,
  Package,
} from 'lucide-react';

interface UserProfile {
  uid: string;
  email: string;
  name: string;
  role: 'manager' | 'staff';
}

interface QueuedOfflineEntry {
  clientEntryId: string;
  tankId: number;
  materialId: number | null;
  type: 'load' | 'use' | 'reading';
  entryTimestamp: string;
  note: string;
  kg: number;
  kgPerLitre: number;
  supplierBillLot: string;
  productBatch: string;
  gapCenterCm: number;
  gapWallCm: number;
}

const OFFLINE_QUEUE_KEY = 'kr_agro_tank_stock_offline_outbox_v1';

type ActiveTab = 'home' | 'tank-detail' | '3d-bay' | 'reports' | 'studio' | 'sensor-deploy';

export default function App() {
  // Authentication state (stored in memory; defaults to signed-in manager with instant login/switch modal)
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<UserProfile>({
    uid: 'usr-manager-1',
    email: 'manager@kragro.com',
    name: 'Rajesh Nair (Plant Manager)',
    role: 'manager',
  });
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loginEmail, setLoginEmail] = useState<string>('manager@kragro.com');
  const [loginPassword, setLoginPassword] = useState<string>('kragro123');
  const [registerName, setRegisterName] = useState<string>('');
  const [registerRole, setRegisterRole] = useState<'manager' | 'staff'>('staff');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState<boolean>(false);

  // Navigation & Selected Tank
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [selectedTankId, setSelectedTankId] = useState<number>(1);
  const [homeFilterMaterial, setHomeFilterMaterial] = useState<string>('all');

  // Application Data State (Server Authoritative + Optimistic Offline Support)
  const [materials, setMaterials] = useState<MaterialRecord[]>(INITIAL_MATERIALS);
  const [tanks, setTanks] = useState<TankRecord[]>(INITIAL_TANKS);
  const [entries, setEntries] = useState<TankEntryRecord[]>(INITIAL_ENTRIES);
  const [loadingData, setLoadingData] = useState<boolean>(false);

  // Entry Modal State
  const [entryModalConfig, setEntryModalConfig] = useState<{
    tankId: number;
    type: 'load' | 'use' | 'reading';
    editingEntry?: TankEntryRecord | null;
  } | null>(null);

  // Material Manager Form State (inside Studio tab)
  const [newMatName, setNewMatName] = useState<string>('');
  const [newMatCode, setNewMatCode] = useState<string>('');
  const [newMatLot, setNewMatLot] = useState<string>('');
  const [newMatDensity, setNewMatDensity] = useState<string>('0.78');
  const [newMatColor, setNewMatColor] = useState<string>('#d97706');
  const [editingMatId, setEditingMatId] = useState<number | null>(null);

  // Offline Queue & Connectivity State
  const browserOnline = useOnlineStatus();
  const [simulateOffline, setSimulateOffline] = useState<boolean>(false);
  const isOnline = browserOnline && !simulateOffline;

  const [offlineQueue, setOfflineQueue] = useState<QueuedOfflineEntry[]>(() => {
    try {
      const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [syncingOffline, setSyncingOffline] = useState<boolean>(false);

  const saveOfflineQueue = (nextQueue: QueuedOfflineEntry[]) => {
    setOfflineQueue(nextQueue);
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(nextQueue));
    } catch {
      // ignore storage quota errors
    }
  };

  // Auto-authenticate default session on first mount so preview works immediately
  useEffect(() => {
    let mounted = true;
    async function initDefaultSession() {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'manager@kragro.com',
            password: 'kragro123',
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (mounted && data.token) {
            setAuthToken(data.token);
            setCurrentUser(data.user);
          }
        }
      } catch {
        // Offline or initial boot
      }
    }
    initDefaultSession();
    return () => {
      mounted = false;
    };
  }, []);

  // Fetch Full Authoritative State from Backend
  const fetchServerState = useCallback(
    async (tokenOverride?: string | null) => {
      const activeToken = tokenOverride ?? authToken;
      if (!activeToken || !isOnline) return;
      setLoadingData(true);
      try {
        const res = await fetch('/api/state', {
          headers: {
            Authorization: `Bearer ${activeToken}`,
          },
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.materials)) setMaterials(data.materials);
          if (Array.isArray(data.tanks)) setTanks(data.tanks);
          if (Array.isArray(data.entries)) setEntries(data.entries);
          if (data.currentUser) setCurrentUser(data.currentUser);
        }
      } catch {
        // Keep current local state if offline
      } finally {
        setLoadingData(false);
      }
    },
    [authToken, isOnline]
  );

  useEffect(() => {
    if (authToken && isOnline) {
      fetchServerState(authToken);
    }
  }, [authToken, isOnline, fetchServerState]);

  // WebSocket Live Multi-Phone Sync
  useEffect(() => {
    if (!isOnline) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws`;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | undefined;

    function connectWs() {
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.event === 'entry:created' && msg.payload) {
              const incoming = msg.payload as TankEntryRecord;
              setEntries((prev) => {
                if (
                  prev.some(
                    (e) =>
                      e.id === incoming.id ||
                      e.clientEntryId === incoming.clientEntryId
                  )
                ) {
                  return prev.map((e) =>
                    e.clientEntryId === incoming.clientEntryId ? incoming : e
                  );
                }
                return [...prev, incoming];
              });
            } else if (msg.event === 'entry:updated' && msg.payload) {
              const updated = msg.payload as TankEntryRecord;
              setEntries((prev) =>
                prev.map((e) => (e.id === updated.id ? updated : e))
              );
            } else if (msg.event === 'entry:deleted' && msg.payload) {
              const delId = (msg.payload as { id: number }).id;
              setEntries((prev) => prev.filter((e) => e.id !== delId));
            } else if (msg.event === 'tank:created' && msg.payload) {
              const incoming = msg.payload as TankRecord;
              setTanks((prev) =>
                prev.some((t) => t.id === incoming.id)
                  ? prev
                  : [...prev, incoming]
              );
            } else if (msg.event === 'tank:updated' && msg.payload) {
              const updated = msg.payload as TankRecord;
              setTanks((prev) =>
                prev.map((t) => (t.id === updated.id ? updated : t))
              );
            } else if (msg.event === 'tank:deleted' && msg.payload) {
              const delId = (msg.payload as { id: number }).id;
              setTanks((prev) => prev.filter((t) => t.id !== delId));
            } else if (msg.event === 'material:created' && msg.payload) {
              const incoming = msg.payload as MaterialRecord;
              setMaterials((prev) =>
                prev.some((m) => m.id === incoming.id)
                  ? prev
                  : [...prev, incoming]
              );
            } else if (msg.event === 'material:updated' && msg.payload) {
              const updated = msg.payload as MaterialRecord;
              setMaterials((prev) =>
                prev.map((m) => (m.id === updated.id ? updated : m))
              );
            }
          } catch {
            // ignore malformed ws message
          }
        };
        ws.onclose = () => {
          reconnectTimer = window.setTimeout(connectWs, 4000);
        };
      } catch {
        // ignore ws error
      }
    }

    connectWs();
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [isOnline]);

  // Flush Offline Outbox Queue automatically when connection returns
  useEffect(() => {
    if (!isOnline || !authToken || offlineQueue.length === 0 || syncingOffline) {
      return;
    }

    let cancelled = false;
    async function flushOfflineEntries() {
      setSyncingOffline(true);
      const remaining: QueuedOfflineEntry[] = [];
      for (const item of offlineQueue) {
        if (cancelled) break;
        try {
          const res = await fetch('/api/entries', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify(item),
          });
          if (!res.ok) {
            remaining.push(item);
          }
        } catch {
          remaining.push(item);
        }
      }
      if (!cancelled) {
        saveOfflineQueue(remaining);
        setSyncingOffline(false);
        await fetchServerState(authToken);
      }
    }

    flushOfflineEntries();
    return () => {
      cancelled = true;
    };
  }, [isOnline, authToken, offlineQueue, syncingOffline, fetchServerState]);

  // Compute Real-Time Volumetric & Stock Summary for All Tanks
  const tankSummaries: TankStockSummary[] = useMemo(() => {
    return tanks.map((tank) => {
      const mat = materials.find((m) => m.id === tank.materialId) || null;
      const tankEntries = entries.filter((e) => e.tankId === tank.id);
      return computeTankStockSummary(tank, mat, tankEntries);
    });
  }, [tanks, materials, entries]);

  const selectedSummary = useMemo(
    () =>
      tankSummaries.find((s) => s.tank.id === selectedTankId) ||
      tankSummaries[0] ||
      null,
    [tankSummaries, selectedTankId]
  );

  // Factory-Wide Totals & Material Breakdown
  const factoryStats = useMemo(() => {
    const totalKg = tankSummaries.reduce((acc, s) => acc + s.stockNowKg, 0);
    const totalCapacityKg = tankSummaries.reduce(
      (acc, s) => acc + s.maxCapacityKg,
      0
    );
    const lowTanks = tankSummaries.filter((s) => s.isLowWarning);
    const highTanks = tankSummaries.filter((s) => s.isHighWarning);

    const byMaterial = materials.map((m) => {
      const matching = tankSummaries.filter((s) => s.tank.materialId === m.id);
      const kg = matching.reduce((acc, s) => acc + s.stockNowKg, 0);
      const tankNames = matching.map((s) => s.tank.name);
      return {
        material: m,
        totalKg: Number(kg.toFixed(1)),
        tankNames,
      };
    });

    return {
      totalKg: Number(totalKg.toFixed(1)),
      totalCapacityKg: Number(totalCapacityKg.toFixed(0)),
      lowTanks,
      highTanks,
      byMaterial,
    };
  }, [tankSummaries, materials]);

  // Handlers for Login / Registration / Role Switch
  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthBusy(true);
    try {
      const endpoint =
        authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          authMode === 'login'
            ? { email: loginEmail, password: loginPassword }
            : {
                email: loginEmail,
                password: loginPassword,
                name: registerName || 'Factory Operator',
                role: registerRole,
              }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }
      setAuthToken(data.token);
      setCurrentUser(data.user);
      setShowAuthModal(false);
      await fetchServerState(data.token);
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError(null);
    setAuthBusy(true);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await cred.user.getIdToken();
      setAuthToken(idToken);
      const res = await fetch('/api/auth/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentUser(data.user);
      }
      setShowAuthModal(false);
      await fetchServerState(idToken);
    } catch (err: unknown) {
      setAuthError(
        err instanceof Error ? err.message : 'Google Sign-In failed'
      );
    } finally {
      setAuthBusy(false);
    }
  };

  const handleQuickRoleSwitch = async (role: 'manager' | 'staff') => {
    const demoEmail =
      role === 'manager' ? 'manager@kragro.com' : 'staff@kragro.com';
    const demoPass = role === 'manager' ? 'kragro123' : 'staff123';
    setLoginEmail(demoEmail);
    setLoginPassword(demoPass);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: demoEmail, password: demoPass }),
      });
      if (res.ok) {
        const data = await res.json();
        setAuthToken(data.token);
        setCurrentUser(data.user);
        setShowAuthModal(false);
      } else {
        setCurrentUser({
          uid: role === 'manager' ? 'usr-manager-1' : 'usr-staff-1',
          email: demoEmail,
          name:
            role === 'manager'
              ? 'Rajesh Nair (Plant Manager)'
              : 'Suresh Kumar (Floor Operator)',
          role,
        });
        setShowAuthModal(false);
      }
    } catch {
      setCurrentUser({
        uid: role === 'manager' ? 'usr-manager-1' : 'usr-staff-1',
        email: demoEmail,
        name:
          role === 'manager'
            ? 'Rajesh Nair (Plant Manager)'
            : 'Suresh Kumar (Floor Operator)',
        role,
      });
      setShowAuthModal(false);
    }
  };

  // Submit or Edit Floor Entry (with automatic Offline Queue fallback)
  const handleSubmitEntry = async (
    payload: {
      tankId: number;
      materialId: number | null;
      type: 'load' | 'use' | 'reading';
      entryTimestamp: string;
      note: string;
      kg: number;
      kgPerLitre: number;
      supplierBillLot: string;
      productBatch: string;
      gapCenterCm: number;
      gapWallCm: number;
    },
    editingId?: number
  ) => {
    const clientEntryId = `entry-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    const targetSummary = tankSummaries.find(
      (s) => s.tank.id === payload.tankId
    );
    const calc =
      payload.type === 'reading' && targetSummary
        ? calculateLevelReadingFromGap(
            targetSummary.profile,
            payload.gapCenterCm,
            payload.gapWallCm,
            payload.kgPerLitre
          )
        : null;

    // If editing an existing entry (Manager only)
    if (editingId !== undefined) {
      const res = await fetch(`/api/entries/${editingId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to update entry');
      }
      const { entry } = await res.json();
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? entry : e)));
      return;
    }

    // Optimistic local record for instant UI responsiveness (and offline mode)
    const optimisticEntry: TankEntryRecord = {
      id: Date.now(),
      clientEntryId,
      tankId: payload.tankId,
      materialId: payload.materialId,
      type: payload.type,
      entryTimestamp: payload.entryTimestamp,
      userUid: currentUser.uid,
      userName: currentUser.name,
      note: payload.note,
      source: 'manual',
      kg: calc ? calc.kg : payload.kg,
      kgPerLitre: payload.kgPerLitre,
      supplierBillLot: payload.supplierBillLot,
      productBatch: payload.productBatch,
      gapCenterCm: payload.gapCenterCm,
      gapWallCm: payload.gapWallCm,
      gapAvgCm: calc ? calc.gapAvgCm : 0,
      filledHeightCm: calc ? calc.filledHeightCm : 0,
      calculatedLitres: calc ? calc.litres : 0,
      previousBookKg: targetSummary ? targetSummary.stockNowKg : 0,
      discrepancyKg:
        calc && targetSummary
          ? Number((calc.kg - targetSummary.stockNowKg).toFixed(1))
          : 0,
    };

    setEntries((prev) => [...prev, optimisticEntry]);
    if (payload.type === 'load' && payload.materialId) {
      setTanks((prev) =>
        prev.map((t) =>
          t.id === payload.tankId ? { ...t, materialId: payload.materialId } : t
        )
      );
    }

    if (!isOnline || !authToken) {
      saveOfflineQueue([
        ...offlineQueue,
        {
          clientEntryId,
          ...payload,
        },
      ]);
      return;
    }

    try {
      const res = await fetch('/api/entries', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          clientEntryId,
          ...payload,
        }),
      });
      if (!res.ok) throw new Error('Network error');
      const { entry } = await res.json();
      setEntries((prev) =>
        prev.map((e) => (e.clientEntryId === clientEntryId ? entry : e))
      );
    } catch {
      // Queue for automatic retry when internet returns
      saveOfflineQueue([
        ...offlineQueue,
        {
          clientEntryId,
          ...payload,
        },
      ]);
    }
  };

  const handleDeleteEntry = async (entryId: number) => {
    setEntries((prev) => prev.filter((e) => e.id !== entryId));
    if (!authToken || !isOnline) return;
    await fetch(`/api/entries/${entryId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });
  };

  // Tank Save / Delete Handlers (Manager)
  const handleSaveTank = async (
    tankData: Omit<TankRecord, 'id'>,
    existingId?: number
  ) => {
    if (!authToken) return;
    if (existingId !== undefined) {
      const res = await fetch(`/api/tanks/${existingId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(tankData),
      });
      if (res.ok) {
        const { tank } = await res.json();
        setTanks((prev) => prev.map((t) => (t.id === tank.id ? tank : t)));
      }
    } else {
      const res = await fetch('/api/tanks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(tankData),
      });
      if (res.ok) {
        const { tank } = await res.json();
        setTanks((prev) => [...prev, tank]);
        setSelectedTankId(tank.id);
      }
    }
  };

  const handleDeleteTank = async (tankId: number) => {
    setTanks((prev) => prev.filter((t) => t.id !== tankId));
    setEntries((prev) => prev.filter((e) => e.tankId !== tankId));
    if (!authToken) return;
    await fetch(`/api/tanks/${tankId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });
  };

  // Material Save / Update Handler (Manager)
  const handleSaveMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMatName.trim()) return;
    const payload = {
      name: newMatName.trim(),
      code:
        newMatCode.trim() ||
        newMatName.trim().slice(0, 5).toUpperCase(),
      lotNumber: newMatLot.trim() || 'LOT-2026-M1',
      kgPerLitre: Number(newMatDensity) || 0.78,
      colorHex: newMatColor,
    };

    if (editingMatId !== null) {
      const res = await fetch(`/api/materials/${editingMatId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const { material } = await res.json();
        setMaterials((prev) =>
          prev.map((m) => (m.id === material.id ? material : m))
        );
      }
      setEditingMatId(null);
    } else {
      const res = await fetch('/api/materials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const { material } = await res.json();
        setMaterials((prev) => [...prev, material]);
      }
    }

    setNewMatName('');
    setNewMatCode('');
    setNewMatLot('');
    setNewMatDensity('0.78');
  };

  const visibleSummaries = useMemo(() => {
    if (homeFilterMaterial === 'all') return tankSummaries;
    if (homeFilterMaterial === 'alerts') {
      return tankSummaries.filter((s) => s.isLowWarning || s.isHighWarning);
    }
    return tankSummaries.filter(
      (s) => s.tank.materialId === Number(homeFilterMaterial)
    );
  }, [tankSummaries, homeFilterMaterial]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 pb-20 md:pb-8">
      {/* STRICT 3-ZONE TOP BAR CONTRACT */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-8 px-4 sm:px-6 py-3.5 bg-white border-b border-slate-200">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#overview"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('home');
          }}
          className="text-lg font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          Tank Stock
        </a>

        {/* Zone 2: 4–5 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <a
            href="#overview"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('home');
            }}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'home' || activeTab === 'tank-detail'
                ? 'text-slate-900 font-bold underline underline-offset-8 decoration-2 decoration-amber-600'
                : ''
            }`}
          >
            Overview
          </a>
          <a
            href="#3d-silos"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('3d-bay');
            }}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === '3d-bay'
                ? 'text-slate-900 font-bold underline underline-offset-8 decoration-2 decoration-amber-600'
                : ''
            }`}
          >
            3D Silos
          </a>
          <a
            href="#reports"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('reports');
            }}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'reports'
                ? 'text-slate-900 font-bold underline underline-offset-8 decoration-2 decoration-amber-600'
                : ''
            }`}
          >
            Reports
          </a>
          {currentUser.role === 'manager' && (
            <a
              href="#tank-studio"
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('studio');
              }}
              className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'studio'
                  ? 'text-slate-900 font-bold underline underline-offset-8 decoration-2 decoration-amber-600'
                  : ''
              }`}
            >
              Tank Studio
            </a>
          )}
          <a
            href="#sensor-deploy"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('sensor-deploy');
            }}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'sensor-deploy'
                ? 'text-slate-900 font-bold underline underline-offset-8 decoration-2 decoration-amber-600'
                : ''
            }`}
          >
            Deploy Guide
          </a>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setShowAuthModal(true)}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {currentUser.role === 'manager' ? 'Manager Account' : 'Staff Account'}
          </button>
        </div>
      </header>

      {/* Offline Queue & Connectivity Banner */}
      {(!isOnline || offlineQueue.length > 0) && (
        <div className="bg-amber-600 text-white px-4 py-2.5 text-xs font-semibold flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>
              {!isOnline
                ? `Offline Phone Mode Active — New entries are saved on this phone (${offlineQueue.length} waiting to send).`
                : `Syncing ${offlineQueue.length} offline phone entries to server...`}
            </span>
          </div>
          {simulateOffline && (
            <button
              type="button"
              onClick={() => setSimulateOffline(false)}
              className="px-2.5 py-1 rounded bg-white text-amber-900 font-bold hover:bg-amber-50 cursor-pointer"
            >
              Reconnect & Send Queued Entries Now
            </button>
          )}
        </div>
      )}

      {/* Main Content Container (Full 1440px max-w-7xl presence on desktop, ergonomic touch layout on mobile) */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-5 space-y-6">
        {/* Sub-Header Workspace Toolbar: Company Identity, Role Switcher, Offline Test & PWA Install */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-200/80">
          <div>
            <div className="text-xs font-medium text-slate-500">
              K R Agro Food Industries · Hopper-Bottom Rice & Grain Silo Control
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Signed in as <strong className="text-slate-800">{currentUser.name}</strong> · Role: <strong className="text-amber-700 uppercase">{currentUser.role}</strong>
              {loadingData && ' · Updating live...'}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Instant Role Toggle for Testing Staff Phone View vs Manager View */}
            <div className="flex items-center gap-1 bg-slate-200/70 p-1 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => handleQuickRoleSwitch('staff')}
                className={`px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  currentUser.role === 'staff'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Staff View
              </button>
              <button
                type="button"
                onClick={() => handleQuickRoleSwitch('manager')}
                className={`px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  currentUser.role === 'manager'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Manager View
              </button>
            </div>

            {/* Offline Queue Test Toggle */}
            <button
              type="button"
              onClick={() => setSimulateOffline((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                simulateOffline
                  ? 'bg-amber-100 border-amber-300 text-amber-900'
                  : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
              }`}
              title="Test offline phone entry saving when factory internet drops"
            >
              <WifiOff className="w-3.5 h-3.5" />
              <span>{simulateOffline ? 'Offline Test: ON' : 'Test Offline'}</span>
            </button>

            <PWAInstallButton />
          </div>
        </div>

        {/* =================================================================== */}
        {/* SCREEN 1: HOME DASHBOARD (Total kg, kg by material, Tank cards)     */}
        {/* =================================================================== */}
        {activeTab === 'home' && (
          <div className="space-y-6">
            {/* Low or Nearly Full Tank Warning Banner */}
            {(factoryStats.lowTanks.length > 0 ||
              factoryStats.highTanks.length > 0) && (
              <div className="rounded-2xl bg-white border border-red-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <div className="space-y-1 text-xs">
                    <div className="font-bold text-slate-900 text-sm">
                      Tank Level Warnings Active
                    </div>
                    {factoryStats.lowTanks.length > 0 && (
                      <div className="text-red-700 font-medium">
                        Low Stock Alert (below limit):{' '}
                        {factoryStats.lowTanks
                          .map(
                            (s) =>
                              `Tank ${s.tank.name} (${s.fillPercent.toFixed(
                                0
                              )}% — ${s.stockNowKg.toLocaleString()} kg ${
                                s.material?.name || ''
                              })`
                          )
                          .join(' · ')}
                      </div>
                    )}
                    {factoryStats.highTanks.length > 0 && (
                      <div className="text-amber-800 font-medium">
                        Nearly Full Alert (stop loading):{' '}
                        {factoryStats.highTanks
                          .map(
                            (s) =>
                              `Tank ${s.tank.name} (${s.fillPercent.toFixed(
                                0
                              )}% — ${s.stockNowKg.toLocaleString()} kg ${
                                s.material?.name || ''
                              })`
                          )
                          .join(' · ')}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setHomeFilterMaterial(
                      homeFilterMaterial === 'alerts' ? 'all' : 'alerts'
                    )
                  }
                  className="px-3.5 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-800 text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {homeFilterMaterial === 'alerts'
                    ? 'Show All Tanks'
                    : 'Filter Alert Tanks'}
                </button>
              </div>
            )}

            {/* Top Summary Row: Total Factory Stock + Stock by Material */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
              {/* Total Stock Card */}
              <div className="lg:col-span-4 rounded-2xl bg-slate-900 text-white p-5 flex flex-col justify-between">
                <div>
                  <div className="text-xs font-medium text-slate-400">
                    Total Factory Raw Material Stock
                  </div>
                  <div className="mt-2 text-3xl sm:text-4xl font-extrabold font-mono tabular-nums tracking-tight text-white">
                    {factoryStats.totalKg.toLocaleString()}{' '}
                    <span className="text-lg font-normal text-amber-400">kg</span>
                  </div>
                  <div className="mt-1 text-xs font-mono text-slate-400">
                    {(factoryStats.totalKg / 1000).toFixed(2)} Metric Tonnes across{' '}
                    {tankSummaries.length} hopper tanks
                  </div>
                </div>

                <div className="mt-5 pt-4 border-t border-slate-800 flex items-center justify-between gap-2">
                  <div className="text-xs text-slate-300">
                    Total Capacity:{' '}
                    <span className="font-mono font-bold text-white">
                      {factoryStats.totalCapacityKg.toLocaleString()} kg
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('3d-bay')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Box className="w-3.5 h-3.5" />
                    <span>Open 3D Silo View</span>
                  </button>
                </div>
              </div>

              {/* Stock by Material Breakdown */}
              <div className="lg:col-span-8 rounded-2xl bg-white border border-slate-200 p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-slate-900">
                    Stock by Material (Tap to Filter Tanks)
                  </h2>
                  {homeFilterMaterial !== 'all' && (
                    <button
                      type="button"
                      onClick={() => setHomeFilterMaterial('all')}
                      className="text-xs font-semibold text-amber-700 hover:underline cursor-pointer"
                    >
                      Clear Filter
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {factoryStats.byMaterial.map(({ material, totalKg, tankNames }) => {
                    const isSelected =
                      homeFilterMaterial === String(material.id);
                    return (
                      <button
                        key={material.id}
                        type="button"
                        onClick={() =>
                          setHomeFilterMaterial(
                            isSelected ? 'all' : String(material.id)
                          )
                        }
                        className={`text-left rounded-xl p-3 border transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-slate-50/70 hover:bg-slate-100 border-slate-200/90 text-slate-900'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold truncate">
                            {material.name}
                          </span>
                          <span
                            className="w-2.5 h-2.5 rounded-sm shrink-0"
                            style={{ backgroundColor: material.colorHex }}
                          />
                        </div>
                        <div className="mt-1.5 text-lg font-extrabold font-mono tabular-nums">
                          {totalKg.toLocaleString()} kg
                        </div>
                        <div
                          className={`mt-0.5 text-[11px] font-mono ${
                            isSelected ? 'text-slate-300' : 'text-slate-500'
                          }`}
                        >
                          Tanks: {tankNames.length > 0 ? tankNames.join(', ') : 'None'} ·{' '}
                          {material.kgPerLitre} kg/L
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Tank Cards Grid: One card per tank with small tank picture filled to its level */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-bold text-slate-900">
                  Hopper-Bottom Tanks ({visibleSummaries.length})
                </h2>
                {currentUser.role === 'manager' && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('studio')}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-white border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-100 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 text-amber-600" />
                    <span>Add / Edit Tank Shapes</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {visibleSummaries.map((s) => {
                  const lastReadStr = s.lastReadingEntry
                    ? new Date(
                        s.lastReadingEntry.entryTimestamp
                      ).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'No reading yet (Book Stock)';

                  return (
                    <div
                      key={s.tank.id}
                      className={`rounded-2xl bg-white border transition-shadow hover:shadow-md flex flex-col justify-between p-4 ${
                        s.isLowWarning
                          ? 'border-red-300'
                          : s.isHighWarning
                          ? 'border-amber-400'
                          : 'border-slate-200'
                      }`}
                    >
                      {/* Top Card Header + Warning Status */}
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedTankId(s.tank.id);
                                  setActiveTab('tank-detail');
                                }}
                                className="text-lg font-extrabold text-slate-900 hover:text-amber-700 cursor-pointer"
                              >
                                Tank {s.tank.name}
                              </button>
                              {s.isLowWarning && (
                                <span className="text-xs font-bold text-red-600 flex items-center gap-1">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  LOW (&lt;{s.tank.lowWarningPercent}%)
                                </span>
                              )}
                              {s.isHighWarning && (
                                <span className="text-xs font-bold text-amber-700 flex items-center gap-1">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  NEARLY FULL (&gt;{s.tank.highWarningPercent}%)
                                </span>
                              )}
                            </div>
                            <div className="text-xs font-semibold text-slate-600 mt-0.5">
                              {s.material?.name || 'Empty / Unassigned'}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setSelectedTankId(s.tank.id);
                              setActiveTab('tank-detail');
                            }}
                            className="text-xs font-semibold text-amber-700 hover:underline cursor-pointer whitespace-nowrap"
                          >
                            3D & History →
                          </button>
                        </div>

                        {/* Middle Body: Small Tank Picture Filled to Level + Stock Numbers */}
                        <div
                          onClick={() => {
                            setSelectedTankId(s.tank.id);
                            setActiveTab('tank-detail');
                          }}
                          className="mt-3 flex items-center gap-4 cursor-pointer"
                        >
                          <div className="shrink-0 bg-slate-50 rounded-xl p-1.5 border border-slate-100">
                            <Tank2DCrossSection
                              profile={s.profile}
                              filledHeightCm={s.filledHeightCm}
                              fillPercent={s.fillPercent}
                              materialColor={s.material?.colorHex || '#d97706'}
                              isLowWarning={s.isLowWarning}
                              isHighWarning={s.isHighWarning}
                              className="w-20 h-28"
                            />
                          </div>

                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div>
                              <div className="text-[11px] text-slate-500">
                                Stock Now
                              </div>
                              <div className="text-2xl font-extrabold font-mono tabular-nums text-slate-900">
                                {s.stockNowKg.toLocaleString()}{' '}
                                <span className="text-xs font-normal text-slate-500">
                                  kg
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                              <span className="font-bold text-slate-800">
                                {s.fillPercent.toFixed(1)}% Full
                              </span>
                              <span className="text-slate-500">
                                {s.currentLitres.toLocaleString()} L
                              </span>
                            </div>

                            {/* Progress Bar */}
                            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  s.isLowWarning
                                    ? 'bg-red-600'
                                    : s.isHighWarning
                                    ? 'bg-amber-600'
                                    : 'bg-emerald-600'
                                }`}
                                style={{
                                  width: `${Math.min(100, s.fillPercent)}%`,
                                }}
                              />
                            </div>

                            <div className="text-[11px] text-slate-500 truncate">
                              Reading: <span className="font-mono">{lastReadStr}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Quick Phone Action Buttons on Card */}
                      <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-3 gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setEntryModalConfig({
                              tankId: s.tank.id,
                              type: 'load',
                            })
                          }
                          className="min-h-[40px] flex items-center justify-center gap-1 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <ArrowDownToLine className="w-3.5 h-3.5" />
                          <span>Load</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEntryModalConfig({
                              tankId: s.tank.id,
                              type: 'use',
                            })
                          }
                          className="min-h-[40px] flex items-center justify-center gap-1 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-800 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <Cog className="w-3.5 h-3.5" />
                          <span>Use</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEntryModalConfig({
                              tankId: s.tank.id,
                              type: 'reading',
                            })
                          }
                          className="min-h-[40px] flex items-center justify-center gap-1 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <Ruler className="w-3.5 h-3.5" />
                          <span>Reading</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* SCREEN 2: TANK DETAIL PAGE (3D Hopper, Stock Math, Big Buttons, Log)*/}
        {/* =================================================================== */}
        {activeTab === 'tank-detail' && selectedSummary && (
          <div className="space-y-6">
            {/* Tank Switcher Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setActiveTab('home')}
                  className="min-h-[44px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 inline-flex items-center gap-1.5 text-xs font-bold cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>All Tanks</span>
                </button>
                <div>
                  <h1 className="text-xl font-extrabold text-slate-900">
                    Tank {selectedSummary.tank.name} —{' '}
                    {selectedSummary.material?.name || 'Unassigned'}
                  </h1>
                  <p className="text-xs text-slate-500 font-mono">
                    Lot: {selectedSummary.material?.lotNumber || 'N/A'} · Active Density:{' '}
                    {selectedSummary.activeKgPerLitre} kg/L · Correction Factor:{' '}
                    {selectedSummary.tank.correctionFactor}
                  </p>
                </div>
              </div>

              {/* Quick Switch Between Tanks */}
              <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-xl">
                {tankSummaries.map((s) => (
                  <button
                    key={s.tank.id}
                    type="button"
                    onClick={() => setSelectedTankId(s.tank.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                      s.tank.id === selectedSummary.tank.id
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {s.tank.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Big Phone Action Buttons for Staff Entries */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() =>
                  setEntryModalConfig({
                    tankId: selectedSummary.tank.id,
                    type: 'load',
                  })
                }
                className="min-h-[56px] rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white p-4 flex items-center justify-between shadow-sm transition-colors cursor-pointer"
              >
                <div className="text-left">
                  <div className="text-sm font-extrabold">
                    1. Loaded into Tank
                  </div>
                  <div className="text-xs text-emerald-100">
                    Add kg, density & supplier bill/lot
                  </div>
                </div>
                <ArrowDownToLine className="w-6 h-6 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() =>
                  setEntryModalConfig({
                    tankId: selectedSummary.tank.id,
                    type: 'use',
                  })
                }
                className="min-h-[56px] rounded-2xl bg-blue-600 hover:bg-blue-500 text-white p-4 flex items-center justify-between shadow-sm transition-colors cursor-pointer"
              >
                <div className="text-left">
                  <div className="text-sm font-extrabold">
                    2. Used for Production
                  </div>
                  <div className="text-xs text-blue-100">
                    Record kg drawn & batch made
                  </div>
                </div>
                <Cog className="w-6 h-6 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() =>
                  setEntryModalConfig({
                    tankId: selectedSummary.tank.id,
                    type: 'reading',
                  })
                }
                className="min-h-[56px] rounded-2xl bg-amber-600 hover:bg-amber-500 text-white p-4 flex items-center justify-between shadow-sm transition-colors cursor-pointer"
              >
                <div className="text-left">
                  <div className="text-sm font-extrabold">
                    3. Take Level Reading
                  </div>
                  <div className="text-xs text-amber-100">
                    Enter top empty gap (cm) & kg/L
                  </div>
                </div>
                <Ruler className="w-6 h-6 shrink-0" />
              </button>
            </div>

            {/* Split View: 3D Interactive Hopper Tank + Stock Formula & Discrepancy Card */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              <div className="lg:col-span-7">
                <Tank3DViewport
                  mode="single"
                  summary={selectedSummary}
                  heightClass="h-[420px] sm:h-[460px]"
                />
              </div>

              <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 flex flex-col justify-between space-y-4">
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
                    <div>
                      <div className="text-xs font-semibold text-slate-500">
                        Stock Now in Tank {selectedSummary.tank.name}
                      </div>
                      <div className="text-3xl font-extrabold font-mono tabular-nums text-slate-900 mt-1">
                        {selectedSummary.stockNowKg.toLocaleString()}{' '}
                        <span className="text-base font-normal text-slate-500">
                          kg
                        </span>
                      </div>
                      <div className="text-xs font-mono text-slate-500 mt-1">
                        {selectedSummary.currentLitres.toLocaleString()} Litres /{' '}
                        {selectedSummary.profile.totalCapacityLitres.toLocaleString()} L (
                        {selectedSummary.fillPercent.toFixed(1)}% Full)
                      </div>
                    </div>

                    <Tank2DCrossSection
                      profile={selectedSummary.profile}
                      filledHeightCm={selectedSummary.filledHeightCm}
                      fillPercent={selectedSummary.fillPercent}
                      materialColor={
                        selectedSummary.material?.colorHex || '#d97706'
                      }
                      isLowWarning={selectedSummary.isLowWarning}
                      isHighWarning={selectedSummary.isHighWarning}
                      showDimensions={true}
                      className="w-28 h-36 shrink-0"
                    />
                  </div>

                  {/* Exact Stock Formula Breakdown */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      How Current Stock is Calculated
                    </h3>
                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-2 text-xs font-mono tabular-nums">
                      {selectedSummary.lastReadingEntry ? (
                        <>
                          <div className="flex justify-between text-slate-700">
                            <span>
                              Last Level Reading (
                              {new Date(
                                selectedSummary.lastReadingEntry.entryTimestamp
                              ).toLocaleDateString()}
                              ):
                            </span>
                            <span className="font-bold text-slate-900">
                              {selectedSummary.lastReadingEntry.kg.toLocaleString()} kg
                            </span>
                          </div>
                          <div className="flex justify-between text-emerald-700">
                            <span>+ Loaded Since Reading:</span>
                            <span className="font-bold">
                              +{selectedSummary.loadedSinceReadingKg.toLocaleString()} kg
                            </span>
                          </div>
                          <div className="flex justify-between text-blue-700">
                            <span>- Used Since Reading:</span>
                            <span className="font-bold">
                              -{selectedSummary.usedSinceReadingKg.toLocaleString()} kg
                            </span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-slate-500 font-sans text-[11px] pb-1">
                            No level reading taken yet — using Loaded minus Used:
                          </div>
                          <div className="flex justify-between text-emerald-700">
                            <span>Total Loaded into Tank:</span>
                            <span className="font-bold">
                              +{selectedSummary.totalLoadedAllTimeKg.toLocaleString()} kg
                            </span>
                          </div>
                          <div className="flex justify-between text-blue-700">
                            <span>- Total Used for Production:</span>
                            <span className="font-bold">
                              -{selectedSummary.totalUsedAllTimeKg.toLocaleString()} kg
                            </span>
                          </div>
                        </>
                      )}
                      <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-bold text-slate-900">
                        <span>= Stock Now:</span>
                        <span>{selectedSummary.stockNowKg.toLocaleString()} kg</span>
                      </div>
                    </div>
                  </div>

                  {/* Book Stock vs Physical Level Reading Difference Box */}
                  {selectedSummary.lastReadingEntry && (
                    <div className="rounded-xl bg-amber-50/70 border border-amber-200 p-3.5 space-y-1 text-xs">
                      <div className="font-bold text-slate-900">
                        Book Stock vs Last Level Reading Audit
                      </div>
                      <div className="flex justify-between font-mono text-slate-600">
                        <span>Book Stock Before Reading:</span>
                        <span>
                          {selectedSummary.lastReadingEntry.previousBookKg.toLocaleString()}{' '}
                          kg
                        </span>
                      </div>
                      <div className="flex justify-between font-mono text-slate-600">
                        <span>
                          Measured Reading (Gap {selectedSummary.lastReadingEntry.gapAvgCm}{' '}
                          cm):
                        </span>
                        <span>
                          {selectedSummary.lastReadingEntry.kg.toLocaleString()} kg
                        </span>
                      </div>
                      <div className="flex justify-between font-mono font-bold pt-1 border-t border-amber-200/80">
                        <span>Difference (Gain / Loss):</span>
                        <span
                          className={
                            selectedSummary.lastDiscrepancyKg < 0
                              ? 'text-red-700'
                              : 'text-emerald-700'
                          }
                        >
                          {selectedSummary.lastDiscrepancyKg > 0 ? '+' : ''}
                          {selectedSummary.lastDiscrepancyKg.toLocaleString()} kg
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {currentUser.role === 'manager' && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('studio')}
                    className="w-full rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 py-2.5 text-xs font-bold text-slate-800 transition-colors cursor-pointer"
                  >
                    Edit Tank {selectedSummary.tank.name} Shape & Calibration in Studio
                  </button>
                )}
              </div>
            </div>

            {/* Tank Entry History Table (Manager can Correct or Delete any entry) */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Tank {selectedSummary.tank.name} — Entry History
                  </h3>
                  <p className="text-xs text-slate-500">
                    {currentUser.role === 'manager'
                      ? 'Manager mode: You can correct or delete any entry.'
                      : 'Staff mode: View-only history. Ask a manager to correct past entries.'}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <th className="py-3 px-4 font-semibold">Date & Time</th>
                      <th className="py-3 px-4 font-semibold">Entry Type</th>
                      <th className="py-3 px-4 text-right font-semibold">Weight (kg)</th>
                      <th className="py-3 px-4 text-right font-semibold">kg/L</th>
                      <th className="py-3 px-4 font-semibold">
                        Supplier / Batch / Reading Details
                      </th>
                      <th className="py-3 px-4 font-semibold">Staff / Note</th>
                      {currentUser.role === 'manager' && (
                        <th className="py-3 px-4 text-right font-semibold">
                          Manager Actions
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {entries
                      .filter((e) => e.tankId === selectedSummary.tank.id)
                      .sort(
                        (a, b) =>
                          new Date(b.entryTimestamp).getTime() -
                          new Date(a.entryTimestamp).getTime()
                      )
                      .map((e) => (
                        <tr key={e.id} className="hover:bg-slate-50/80">
                          <td className="py-3 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                            {new Date(e.entryTimestamp).toLocaleString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="py-3 px-4 font-bold">
                            {e.type === 'load' ? (
                              <span className="text-emerald-700">
                                1. Loaded into Tank
                              </span>
                            ) : e.type === 'use' ? (
                              <span className="text-blue-700">
                                2. Used for Production
                              </span>
                            ) : (
                              <span className="text-amber-700">
                                3. Level Reading
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                            {e.type === 'load'
                              ? '+'
                              : e.type === 'use'
                              ? '-'
                              : ''}
                            {e.kg.toLocaleString()} kg
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                            {e.kgPerLitre.toFixed(2)}
                          </td>
                          <td className="py-3 px-4 text-slate-700">
                            {e.type === 'load' && (
                              <span>Supplier/Bill/Lot: {e.supplierBillLot}</span>
                            )}
                            {e.type === 'use' && (
                              <span>Batch Made: {e.productBatch}</span>
                            )}
                            {e.type === 'reading' && (
                              <span className="font-mono">
                                Top Gap: {e.gapAvgCm} cm (Centre {e.gapCenterCm} /
                                Wall {e.gapWallCm} cm) →{' '}
                                {e.calculatedLitres.toLocaleString()} L · Book vs
                                Reading Diff:{' '}
                                <strong
                                  className={
                                    e.discrepancyKg < 0
                                      ? 'text-red-600'
                                      : 'text-emerald-700'
                                  }
                                >
                                  {e.discrepancyKg > 0 ? '+' : ''}
                                  {e.discrepancyKg} kg
                                </strong>
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-600">
                            <div className="font-medium text-slate-800">
                              {e.userName}
                            </div>
                            {e.note && (
                              <div className="text-[11px] text-slate-500">
                                {e.note}
                              </div>
                            )}
                          </td>
                          {currentUser.role === 'manager' && (
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEntryModalConfig({
                                      tankId: selectedSummary.tank.id,
                                      type: e.type,
                                      editingEntry: e,
                                    })
                                  }
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                                  title="Correct Entry"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteEntry(e.id)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                                  title="Delete Entry"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* SCREEN 3: 3D SILO BAY OVERVIEW (Full 3D Factory View)               */}
        {/* =================================================================== */}
        {activeTab === '3d-bay' && (
          <div className="space-y-5">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  3D Hopper-Bottom Silo Bay — K R Agro Food Industries
                </h2>
                <p className="text-xs text-slate-500">
                  Interactive 3D view of all {tankSummaries.length} hopper-bottom tanks, bottom outlets, and conveyors. Tap any 3D tank to open its detail view.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {tankSummaries.map((s) => (
                  <button
                    key={s.tank.id}
                    type="button"
                    onClick={() => {
                      setSelectedTankId(s.tank.id);
                      setActiveTab('tank-detail');
                    }}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-900 hover:text-white text-xs font-bold text-slate-800 transition-colors cursor-pointer"
                  >
                    Tank {s.tank.name} ({s.fillPercent.toFixed(0)}%)
                  </button>
                ))}
              </div>
            </div>

            <Tank3DViewport
              mode="factory"
              summaries={tankSummaries}
              selectedTankId={selectedTankId}
              onSelectTank={(id) => {
                setSelectedTankId(id);
                setActiveTab('tank-detail');
              }}
              heightClass="h-[520px] sm:h-[600px]"
            />
          </div>
        )}

        {/* =================================================================== */}
        {/* SCREEN 4: REPORTS & EXCEL EXPORT                                    */}
        {/* =================================================================== */}
        {activeTab === 'reports' && (
          <ReportsView
            summaries={tankSummaries}
            materials={materials}
            entries={entries}
          />
        )}

        {/* =================================================================== */}
        {/* SCREEN 5: MANAGER TANK DRAWING STUDIO & MATERIAL CATALOG            */}
        {/* =================================================================== */}
        {activeTab === 'studio' && (
          <div className="space-y-8">
            <TankGeometryEditor
              tanks={tanks}
              materials={materials}
              selectedTank={selectedSummary?.tank || tanks[0] || null}
              onSaveTank={handleSaveTank}
              onDeleteTank={handleDeleteTank}
            />

            {/* Material & Lot Density Catalog Manager */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-amber-600" />
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Material & Lot Density Catalog (kg per litre)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Keep your raw material list with reference kg-per-litre for each lot.
                  </p>
                </div>
              </div>

              <form
                onSubmit={handleSaveMaterial}
                className="grid grid-cols-1 sm:grid-cols-6 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200 items-end"
              >
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Material Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Palakkad Matta Rice"
                    value={newMatName}
                    onChange={(e) => setNewMatName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Code
                  </label>
                  <input
                    type="text"
                    placeholder="MATTA-02"
                    value={newMatCode}
                    onChange={(e) => setNewMatCode(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Lot Number
                  </label>
                  <input
                    type="text"
                    placeholder="LOT-2026-M110"
                    value={newMatLot}
                    onChange={(e) => setNewMatLot(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    kg per Litre
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    required
                    value={newMatDensity}
                    onChange={(e) => setNewMatDensity(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono text-slate-900"
                  />
                </div>
                <div>
                  <button
                    type="submit"
                    className="w-full rounded-lg bg-slate-900 py-2 px-3 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer"
                  >
                    {editingMatId !== null ? 'Update Lot' : '+ Add Material'}
                  </button>
                </div>
              </form>

              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <th className="py-2.5 px-4 font-semibold">Material</th>
                      <th className="py-2.5 px-4 font-semibold">Code</th>
                      <th className="py-2.5 px-4 font-semibold">Lot Number</th>
                      <th className="py-2.5 px-4 text-right font-semibold">
                        Reference kg/Litre
                      </th>
                      <th className="py-2.5 px-4 text-right font-semibold">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {materials.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50/80">
                        <td className="py-2.5 px-4 font-bold text-slate-900 flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-sm shrink-0"
                            style={{ backgroundColor: m.colorHex }}
                          />
                          <span>{m.name}</span>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-600">
                          {m.code}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-600">
                          {m.lotNumber}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900">
                          {m.kgPerLitre.toFixed(3)} kg/L
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMatId(m.id);
                              setNewMatName(m.name);
                              setNewMatCode(m.code);
                              setNewMatLot(m.lotNumber);
                              setNewMatDensity(String(m.kgPerLitre));
                              setNewMatColor(m.colorHex);
                            }}
                            className="text-xs font-semibold text-amber-700 hover:underline cursor-pointer"
                          >
                            Edit Lot
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* SCREEN 6: NON-PROGRAMMER DEPLOY GUIDE & MASTER PROMPT               */}
        {/* =================================================================== */}
        {activeTab === 'sensor-deploy' && <DeployAndSensorView />}
      </main>

      {/* MOBILE BOTTOM NAVIGATION BAR (Thumb-Zone Ergonomics) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 grid grid-cols-5 items-center h-16 pb-safe">
        <button
          type="button"
          onClick={() => setActiveTab('home')}
          className={`flex flex-col items-center justify-center h-full cursor-pointer ${
            activeTab === 'home' || activeTab === 'tank-detail'
              ? 'text-amber-600 font-bold'
              : 'text-slate-500'
          }`}
        >
          <LayoutGrid className="w-5 h-5" />
          <span className="text-[10px] mt-1">Tanks</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('3d-bay')}
          className={`flex flex-col items-center justify-center h-full cursor-pointer ${
            activeTab === '3d-bay' ? 'text-amber-600 font-bold' : 'text-slate-500'
          }`}
        >
          <Box className="w-5 h-5" />
          <span className="text-[10px] mt-1">3D View</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('reports')}
          className={`flex flex-col items-center justify-center h-full cursor-pointer ${
            activeTab === 'reports' ? 'text-amber-600 font-bold' : 'text-slate-500'
          }`}
        >
          <FileSpreadsheet className="w-5 h-5" />
          <span className="text-[10px] mt-1">Reports</span>
        </button>

        <button
          type="button"
          onClick={() =>
            setActiveTab(
              currentUser.role === 'manager' ? 'studio' : 'sensor-deploy'
            )
          }
          className={`flex flex-col items-center justify-center h-full cursor-pointer ${
            activeTab === 'studio' ? 'text-amber-600 font-bold' : 'text-slate-500'
          }`}
        >
          <Sliders className="w-5 h-5" />
          <span className="text-[10px] mt-1">
            {currentUser.role === 'manager' ? 'Draw Tank' : 'Guide'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('sensor-deploy')}
          className={`flex flex-col items-center justify-center h-full cursor-pointer ${
            activeTab === 'sensor-deploy'
              ? 'text-amber-600 font-bold'
              : 'text-slate-500'
          }`}
        >
          <Radio className="w-5 h-5" />
          <span className="text-[10px] mt-1">Deploy</span>
        </button>
      </nav>

      {/* ENTRY MODAL (1. Loaded, 2. Used, 3. Level Reading) */}
      {entryModalConfig && (
        <EntryModal
          summary={
            tankSummaries.find((s) => s.tank.id === entryModalConfig.tankId) ||
            tankSummaries[0]
          }
          materials={materials}
          initialType={entryModalConfig.type}
          editingEntry={entryModalConfig.editingEntry}
          onClose={() => setEntryModalConfig(null)}
          onSubmitEntry={handleSubmitEntry}
        />
      )}

      {/* LOGIN & ROLE ACCOUNT MODAL (Email/Password + Google + Quick Demo Switch) */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  K R Agro Food Industries — Staff & Manager Login
                </h3>
                <p className="text-xs text-slate-500">
                  Sign in with email & password or switch roles
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAuthModal(false)}
                className="text-xs font-bold text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                Close
              </button>
            </div>

            {/* Instant 1-Tap Demo Credentials for Factory Manager vs Floor Staff */}
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
              <div className="text-[11px] font-bold text-slate-600 uppercase">
                Quick Demo Accounts (One Tap):
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleQuickRoleSwitch('manager')}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 text-white py-2 px-3 text-xs font-bold hover:bg-slate-800 cursor-pointer"
                >
                  <Shield className="w-3.5 h-3.5 text-amber-400" />
                  <span>Manager Login</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickRoleSwitch('staff')}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-white border border-slate-300 text-slate-800 py-2 px-3 text-xs font-bold hover:bg-slate-100 cursor-pointer"
                >
                  <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Floor Staff Login</span>
                </button>
              </div>
            </div>

            {/* Email & Password Form */}
            <form onSubmit={handleEmailAuth} className="space-y-3">
              <div className="flex gap-2 text-xs border-b border-slate-100 pb-2">
                <button
                  type="button"
                  onClick={() => setAuthMode('login')}
                  className={`font-bold pb-1 cursor-pointer ${
                    authMode === 'login'
                      ? 'text-slate-900 border-b-2 border-amber-600'
                      : 'text-slate-400'
                  }`}
                >
                  Email & Password Login
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode('register')}
                  className={`font-bold pb-1 cursor-pointer ${
                    authMode === 'register'
                      ? 'text-slate-900 border-b-2 border-amber-600'
                      : 'text-slate-400'
                  }`}
                >
                  Create New Account
                </button>
              </div>

              {authError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-xs text-red-700 font-medium">
                  {authError}
                </div>
              )}

              {authMode === 'register' && (
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Full Name
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Vinod K"
                      value={registerName}
                      onChange={(e) => setRegisterName(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Role
                    </label>
                    <select
                      value={registerRole}
                      onChange={(e) =>
                        setRegisterRole(
                          e.target.value === 'manager' ? 'manager' : 'staff'
                        )
                      }
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs bg-white"
                    >
                      <option value="staff">Staff (Entries Only)</option>
                      <option value="manager">Manager (Full Access)</option>
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={authBusy}
                className="w-full rounded-xl bg-amber-600 hover:bg-amber-500 py-2.5 text-xs font-bold text-white transition-colors cursor-pointer"
              >
                {authBusy
                  ? 'Signing In...'
                  : authMode === 'login'
                  ? 'Sign In with Email & Password'
                  : 'Create Account & Sign In'}
              </button>
            </form>

            <div className="pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={handleGoogleLogin}
                className="w-full rounded-xl border border-slate-300 bg-white hover:bg-slate-50 py-2 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
              >
                Sign In with Google Workspace Account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
