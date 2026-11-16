import React, { useState, useMemo } from 'react';
import {
  MaterialRecord,
  TankEntryRecord,
  TankStockSummary,
  calculateLevelReadingFromGap,
} from '../lib/tankMath.ts';
import {
  ArrowDownToLine,
  Cog,
  Ruler,
  X,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';

interface EntryModalProps {
  summary: TankStockSummary;
  materials: MaterialRecord[];
  initialType: 'load' | 'use' | 'reading';
  editingEntry?: TankEntryRecord | null;
  onClose: () => void;
  onSubmitEntry: (
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
  ) => Promise<void>;
}

function toLocalDatetimeInputValue(isoString?: string): string {
  const d = isoString ? new Date(isoString) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export const EntryModal: React.FC<EntryModalProps> = ({
  summary,
  materials,
  initialType,
  editingEntry = null,
  onClose,
  onSubmitEntry,
}) => {
  const [type, setType] = useState<'load' | 'use' | 'reading'>(
    editingEntry ? editingEntry.type : initialType
  );
  const [materialId, setMaterialId] = useState<number | null>(
    editingEntry
      ? editingEntry.materialId
      : summary.tank.materialId ?? (materials[0]?.id || null)
  );

  // Manual kg per litre input on every entry (as confirmed in Phase 1)
  const selectedMaterial = useMemo(
    () => materials.find((m) => m.id === materialId) || summary.material,
    [materials, materialId, summary.material]
  );

  const [kgPerLitre, setKgPerLitre] = useState<string>(
    editingEntry
      ? String(editingEntry.kgPerLitre)
      : String(selectedMaterial?.kgPerLitre || summary.activeKgPerLitre || 0.78)
  );
  const [kg, setKg] = useState<string>(
    editingEntry ? String(editingEntry.kg) : ''
  );
  const [supplierBillLot, setSupplierBillLot] = useState<string>(
    editingEntry ? editingEntry.supplierBillLot : ''
  );
  const [productBatch, setProductBatch] = useState<string>(
    editingEntry ? editingEntry.productBatch : ''
  );
  const [gapCenterCm, setGapCenterCm] = useState<string>(
    editingEntry
      ? String(editingEntry.gapCenterCm)
      : String(Math.round(summary.emptyGapCm))
  );
  const [gapWallCm, setGapWallCm] = useState<string>(
    editingEntry
      ? String(editingEntry.gapWallCm)
      : String(Math.round(summary.emptyGapCm))
  );
  const [datetimeLocal, setDatetimeLocal] = useState<string>(
    toLocalDatetimeInputValue(editingEntry?.entryTimestamp)
  );
  const [note, setNote] = useState<string>(editingEntry ? editingEntry.note : '');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Real-time Level Reading Volumetric Preview
  const readingPreview = useMemo(() => {
    const c = Number(gapCenterCm) || 0;
    const w = Number(gapWallCm) || 0;
    const d = Number(kgPerLitre) || 0.78;
    const calc = calculateLevelReadingFromGap(summary.profile, c, w, d);
    const bookBase = editingEntry
      ? editingEntry.previousBookKg
      : summary.stockNowKg;
    const diffKg = Number((calc.kg - bookBase).toFixed(1));
    return {
      ...calc,
      bookBase,
      diffKg,
    };
  }, [gapCenterCm, gapWallCm, kgPerLitre, summary, editingEntry]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const parsedDensity = Number(kgPerLitre);
    if ((type === 'load' || type === 'reading') && (!parsedDensity || parsedDensity <= 0)) {
      setErrorMsg('Please type a valid kg per litre density (e.g. 0.78).');
      return;
    }

    if ((type === 'load' || type === 'use') && (!Number(kg) || Number(kg) <= 0)) {
      setErrorMsg('Please enter the weight in kg.');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmitEntry(
        {
          tankId: summary.tank.id,
          materialId,
          type,
          entryTimestamp: new Date(datetimeLocal).toISOString(),
          note: note.trim(),
          kg: type === 'reading' ? readingPreview.kg : Number(kg),
          kgPerLitre: parsedDensity > 0 ? parsedDensity : summary.activeKgPerLitre,
          supplierBillLot: supplierBillLot.trim(),
          productBatch: productBatch.trim(),
          gapCenterCm: Number(gapCenterCm) || 0,
          gapWallCm: Number(gapWallCm) || 0,
        },
        editingEntry?.id
      );
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save entry');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 p-0 sm:p-4">
      <div className="w-full max-w-lg rounded-t-3xl sm:rounded-2xl bg-white shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto">
        {/* Mobile Sheet Grab Handle */}
        <div className="sm:hidden w-12 h-1.5 bg-slate-300 rounded-full mx-auto mt-3" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {editingEntry
                ? `Correct Entry #${editingEntry.id} — Tank ${summary.tank.name}`
                : `Tank ${summary.tank.name} — Record Floor Entry`}
            </h3>
            <p className="text-xs text-slate-500">
              Current Stock: <strong className="font-mono text-slate-800">{summary.stockNowKg.toLocaleString()} kg</strong> ({summary.fillPercent.toFixed(0)}% full)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Entry Type Switcher (if creating new entry) */}
          {!editingEntry && (
            <div className="grid grid-cols-3 gap-2 bg-slate-100 p-1.5 rounded-xl">
              <button
                type="button"
                onClick={() => setType('load')}
                className={`min-h-[44px] flex items-center justify-center gap-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  type === 'load'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                <ArrowDownToLine className="w-4 h-4 shrink-0" />
                <span>1. Loaded</span>
              </button>
              <button
                type="button"
                onClick={() => setType('use')}
                className={`min-h-[44px] flex items-center justify-center gap-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  type === 'use'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                <Cog className="w-4 h-4 shrink-0" />
                <span>2. Used</span>
              </button>
              <button
                type="button"
                onClick={() => setType('reading')}
                className={`min-h-[44px] flex items-center justify-center gap-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  type === 'reading'
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                <Ruler className="w-4 h-4 shrink-0" />
                <span>3. Reading</span>
              </button>
            </div>
          )}

          {errorMsg && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs font-semibold text-red-700">
              {errorMsg}
            </div>
          )}

          {/* 1. LOADED INTO TANK FIELDS */}
          {type === 'load' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Material Loaded into Tank {summary.tank.name}
                </label>
                <select
                  value={materialId ?? ''}
                  onChange={(e) => {
                    const id = e.target.value ? Number(e.target.value) : null;
                    setMaterialId(id);
                    const m = materials.find((x) => x.id === id);
                    if (m) setKgPerLitre(String(m.kgPerLitre));
                  }}
                  className="w-full min-h-[46px] rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-medium text-slate-900 bg-white focus:border-emerald-600 focus:outline-none"
                >
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} — Lot {m.lotNumber} (Ref: {m.kgPerLitre} kg/L)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Weight Loaded (kg) *
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    required
                    placeholder="e.g. 4500"
                    value={kg}
                    onChange={(e) => setKg(e.target.value)}
                    className="w-full min-h-[48px] rounded-xl border border-slate-300 px-3.5 py-2.5 text-base font-bold font-mono text-slate-900 focus:border-emerald-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Bulk Density (kg per litre) *
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    required
                    placeholder="e.g. 0.78"
                    value={kgPerLitre}
                    onChange={(e) => setKgPerLitre(e.target.value)}
                    className="w-full min-h-[48px] rounded-xl border border-slate-300 px-3.5 py-2.5 text-base font-bold font-mono text-slate-900 focus:border-emerald-600 focus:outline-none"
                  />
                  <span className="text-[11px] text-slate-500">
                    Lot reference: {selectedMaterial?.kgPerLitre || 0.78} kg/L
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Supplier / Bill Number / Lot Number *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Kaveri Traders / Bill #4910 / LOT-M104"
                  value={supplierBillLot}
                  onChange={(e) => setSupplierBillLot(e.target.value)}
                  className="w-full min-h-[46px] rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* 2. USED FOR PRODUCTION FIELDS */}
          {type === 'use' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Weight Drawn for Production (kg) *
                </label>
                <input
                  type="number"
                  step="0.1"
                  required
                  placeholder="e.g. 1200"
                  value={kg}
                  onChange={(e) => setKg(e.target.value)}
                  className="w-full min-h-[48px] rounded-xl border border-slate-300 px-3.5 py-2.5 text-base font-bold font-mono text-slate-900 focus:border-blue-600 focus:outline-none"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[500, 1000, 2000, 5000].map((presetKg) => (
                    <button
                      key={presetKg}
                      type="button"
                      onClick={() => setKg(String(presetKg))}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-mono font-semibold text-slate-700 cursor-pointer"
                    >
                      +{presetKg} kg
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Product or Batch Made *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 10kg Retail Matta Pack — Batch #BM-92"
                  value={productBatch}
                  onChange={(e) => setProductBatch(e.target.value)}
                  className="w-full min-h-[46px] rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[
                    '10kg Retail Pack',
                    '25kg Catering Sack',
                    '50kg Wholesale Bag',
                    'Sortex Mill Line 1',
                  ].map((batchLabel) => (
                    <button
                      key={batchLabel}
                      type="button"
                      onClick={() => setProductBatch(batchLabel)}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-700 cursor-pointer"
                    >
                      {batchLabel}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 3. LEVEL READING (EMPTY GAP FROM TOP IN CM) */}
          {type === 'reading' && (
            <div className="space-y-4">
              <div className="rounded-xl bg-amber-50/70 border border-amber-200 p-3 text-xs text-amber-950">
                Measure the <strong>empty space from the top roof down to the rice</strong> at the centre and near the wall (in cm). Tank total height is <strong>{summary.profile.totalHeightCm} cm</strong>.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Centre Empty Gap (cm) *
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min={0}
                    max={summary.profile.totalHeightCm}
                    required
                    value={gapCenterCm}
                    onChange={(e) => setGapCenterCm(e.target.value)}
                    className="w-full min-h-[48px] rounded-xl border border-slate-300 px-3 py-2 text-base font-bold font-mono text-slate-900 focus:border-amber-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Wall Empty Gap (cm) *
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min={0}
                    max={summary.profile.totalHeightCm}
                    required
                    value={gapWallCm}
                    onChange={(e) => setGapWallCm(e.target.value)}
                    className="w-full min-h-[48px] rounded-xl border border-slate-300 px-3 py-2 text-base font-bold font-mono text-slate-900 focus:border-amber-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    kg per litre *
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    required
                    value={kgPerLitre}
                    onChange={(e) => setKgPerLitre(e.target.value)}
                    className="w-full min-h-[48px] rounded-xl border border-slate-300 px-3 py-2 text-base font-bold font-mono text-slate-900 focus:border-amber-600 focus:outline-none"
                  />
                </div>
              </div>

              {/* Instant 1 cm Layer Calculation & Book Stock Comparison Box */}
              <div className="rounded-2xl bg-slate-900 text-white p-4 space-y-2.5">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Average Empty Gap:</span>
                  <span className="font-mono font-bold text-white">
                    {readingPreview.gapAvgCm} cm (Grain Height: {readingPreview.filledHeightCm} cm)
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>1 cm Layer Volume:</span>
                  <span className="font-mono font-bold text-white">
                    {readingPreview.litres.toLocaleString()} Litres ({readingPreview.fillPercent}%)
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm border-t border-slate-800 pt-2">
                  <span className="font-semibold text-slate-200">
                    New Physical Reading Stock:
                  </span>
                  <span className="text-lg font-extrabold font-mono text-amber-400">
                    {readingPreview.kg.toLocaleString()} kg
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs bg-slate-950 rounded-xl p-2.5 border border-slate-800">
                  <div>
                    <div className="text-slate-400">Book Stock Before Reading:</div>
                    <div className="font-mono font-bold text-slate-200">
                      {readingPreview.bookBase.toLocaleString()} kg
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-slate-400">Difference vs Book Stock:</div>
                    <div
                      className={`font-mono font-bold flex items-center justify-end gap-1 ${
                        Math.abs(readingPreview.diffKg) < 50
                          ? 'text-emerald-400'
                          : readingPreview.diffKg < 0
                          ? 'text-red-400'
                          : 'text-amber-400'
                      }`}
                    >
                      {Math.abs(readingPreview.diffKg) < 50 ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {readingPreview.diffKg > 0 ? '+' : ''}
                        {readingPreview.diffKg.toLocaleString()} kg
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Shared Date/Time & Optional Note */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Date & Time
              </label>
              <input
                type="datetime-local"
                required
                value={datetimeLocal}
                onChange={(e) => setDatetimeLocal(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Optional Note
              </label>
              <input
                type="text"
                placeholder="Any remark (moisture, lorry #, etc.)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          {/* Big Submit Button for Phone Ergonomics */}
          <div className="pt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[48px] px-4 rounded-xl border border-slate-200 bg-slate-100 text-xs font-bold text-slate-700 hover:bg-slate-200 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`flex-1 min-h-[48px] rounded-xl text-sm font-bold text-white shadow-sm transition-colors cursor-pointer ${
                type === 'load'
                  ? 'bg-emerald-600 hover:bg-emerald-500'
                  : type === 'use'
                  ? 'bg-blue-600 hover:bg-blue-500'
                  : 'bg-amber-600 hover:bg-amber-500'
              }`}
            >
              {submitting
                ? 'Saving Entry...'
                : editingEntry
                ? 'Save Corrected Entry'
                : type === 'load'
                ? 'Save Loaded Stock Entry'
                : type === 'use'
                ? 'Save Production Use Entry'
                : 'Save Level Reading'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
