import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  MaterialRecord,
  TankEntryRecord,
  TankStockSummary,
} from '../lib/tankMath.ts';
import {
  FileSpreadsheet,
  Calendar,
  Filter,
} from 'lucide-react';

interface ReportsViewProps {
  summaries: TankStockSummary[];
  materials: MaterialRecord[];
  entries: TankEntryRecord[];
}

function getStockAtTimestamp(
  tankId: number,
  allEntries: TankEntryRecord[],
  cutoffTimeMs: number
): number {
  const tankEntries = allEntries
    .filter(
      (e) =>
        e.tankId === tankId &&
        new Date(e.entryTimestamp).getTime() < cutoffTimeMs
    )
    .sort(
      (a, b) =>
        new Date(a.entryTimestamp).getTime() -
        new Date(b.entryTimestamp).getTime()
    );

  let lastReadingIdx = -1;
  for (let i = tankEntries.length - 1; i >= 0; i--) {
    if (tankEntries[i].type === 'reading') {
      lastReadingIdx = i;
      break;
    }
  }

  let stock = lastReadingIdx >= 0 ? tankEntries[lastReadingIdx].kg : 0;
  for (let i = lastReadingIdx + 1; i < tankEntries.length; i++) {
    const e = tankEntries[i];
    if (e.type === 'load') stock += e.kg;
    else if (e.type === 'use') stock -= e.kg;
  }
  return Number(Math.max(0, stock).toFixed(1));
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  summaries,
  materials,
  entries,
}) => {
  const todayStr = new Date().toISOString().slice(0, 10);
  const sevenDaysAgoStr = new Date(Date.now() - 7 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  const [startDate, setStartDate] = useState<string>(sevenDaysAgoStr);
  const [endDate, setEndDate] = useState<string>(todayStr);
  const [filterTankId, setFilterTankId] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');

  const startMs = useMemo(
    () => new Date(`${startDate}T00:00:00`).getTime(),
    [startDate]
  );
  const endMs = useMemo(
    () => new Date(`${endDate}T23:59:59.999`).getTime(),
    [endDate]
  );

  // Per-Tank Date-Range Report (Opening, Loaded, Used, Reading Adjustment, Closing)
  const tankReportRows = useMemo(() => {
    return summaries.map((s) => {
      const openingKg = getStockAtTimestamp(s.tank.id, entries, startMs);
      const closingKg = getStockAtTimestamp(s.tank.id, entries, endMs + 1);

      const inRange = entries.filter((e) => {
        const t = new Date(e.entryTimestamp).getTime();
        return e.tankId === s.tank.id && t >= startMs && t <= endMs;
      });

      let loadedKg = 0;
      let usedKg = 0;
      let readingAdjustKg = 0;
      let readingsCount = 0;

      for (const e of inRange) {
        if (e.type === 'load') loadedKg += e.kg;
        else if (e.type === 'use') usedKg += e.kg;
        else if (e.type === 'reading') {
          readingAdjustKg += e.discrepancyKg;
          readingsCount += 1;
        }
      }

      return {
        tankId: s.tank.id,
        tankName: s.tank.name,
        materialName: s.material?.name || 'Unassigned',
        materialId: s.tank.materialId,
        openingKg: Number(openingKg.toFixed(1)),
        loadedKg: Number(loadedKg.toFixed(1)),
        usedKg: Number(usedKg.toFixed(1)),
        readingAdjustKg: Number(readingAdjustKg.toFixed(1)),
        readingsCount,
        closingKg: Number(closingKg.toFixed(1)),
        capacityLitres: s.profile.totalCapacityLitres,
        fillPercent: s.fillPercent,
      };
    });
  }, [summaries, entries, startMs, endMs]);

  // Per-Material Date-Range Report (Opening, Loaded, Used, Adjustment, Closing)
  const materialReportRows = useMemo(() => {
    return materials.map((m) => {
      const assignedRows = tankReportRows.filter((r) => r.materialId === m.id);
      const tankNames = assignedRows.map((r) => r.tankName).join(', ') || 'None';
      const openingKg = assignedRows.reduce((a, b) => a + b.openingKg, 0);
      const loadedKg = assignedRows.reduce((a, b) => a + b.loadedKg, 0);
      const usedKg = assignedRows.reduce((a, b) => a + b.usedKg, 0);
      const readingAdjustKg = assignedRows.reduce(
        (a, b) => a + b.readingAdjustKg,
        0
      );
      const closingKg = assignedRows.reduce((a, b) => a + b.closingKg, 0);

      return {
        materialId: m.id,
        materialName: m.name,
        code: m.code,
        lotNumber: m.lotNumber,
        kgPerLitre: m.kgPerLitre,
        tankNames,
        openingKg: Number(openingKg.toFixed(1)),
        loadedKg: Number(loadedKg.toFixed(1)),
        usedKg: Number(usedKg.toFixed(1)),
        readingAdjustKg: Number(readingAdjustKg.toFixed(1)),
        closingKg: Number(closingKg.toFixed(1)),
      };
    });
  }, [materials, tankReportRows]);

  const filteredEntries = useMemo(() => {
    return entries
      .filter((e) => {
        const t = new Date(e.entryTimestamp).getTime();
        if (t < startMs || t > endMs) return false;
        if (filterTankId !== 'all' && e.tankId !== Number(filterTankId))
          return false;
        if (filterType !== 'all' && e.type !== filterType) return false;
        return true;
      })
      .sort(
        (a, b) =>
          new Date(b.entryTimestamp).getTime() -
          new Date(a.entryTimestamp).getTime()
      );
  }, [entries, startMs, endMs, filterTankId, filterType]);

  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Per-Tank Stock Report
    const tankSheetData = tankReportRows.map((r) => ({
      'Tank Name': `Tank ${r.tankName}`,
      Material: r.materialName,
      'Opening Stock (kg)': r.openingKg,
      'Loaded (kg)': r.loadedKg,
      'Used for Production (kg)': r.usedKg,
      'Level Reading Diff / Loss (kg)': r.readingAdjustKg,
      'Closing Stock (kg)': r.closingKg,
      'Current % Full': `${r.fillPercent}%`,
      'Tank Capacity (Litres)': r.capacityLitres,
    }));
    const wsTanks = XLSX.utils.json_to_sheet(tankSheetData);
    XLSX.utils.book_append_sheet(wb, wsTanks, 'Tank Report');

    // Sheet 2: Per-Material Stock Report
    const matSheetData = materialReportRows.map((r) => ({
      Material: r.materialName,
      'Material Code': r.code,
      'Lot Number': r.lotNumber,
      'Ref Density (kg/L)': r.kgPerLitre,
      'Tanks Assigned': r.tankNames,
      'Opening Stock (kg)': r.openingKg,
      'Loaded (kg)': r.loadedKg,
      'Used for Production (kg)': r.usedKg,
      'Reading Adjustments (kg)': r.readingAdjustKg,
      'Closing Stock (kg)': r.closingKg,
    }));
    const wsMaterials = XLSX.utils.json_to_sheet(matSheetData);
    XLSX.utils.book_append_sheet(wb, wsMaterials, 'Material Report');

    // Sheet 3: Detailed Entries Ledger
    const tankMap = new Map(summaries.map((s) => [s.tank.id, s.tank.name]));
    const matMap = new Map(materials.map((m) => [m.id, m.name]));
    const ledgerData = filteredEntries.map((e) => ({
      'Entry ID': e.id,
      'Date & Time': new Date(e.entryTimestamp).toLocaleString(),
      Tank: `Tank ${tankMap.get(e.tankId) || e.tankId}`,
      'Entry Type':
        e.type === 'load'
          ? 'Loaded into Tank'
          : e.type === 'use'
          ? 'Used for Production'
          : 'Level Reading',
      Material: e.materialId ? matMap.get(e.materialId) || '' : '',
      'Weight (kg)': e.kg,
      'Density (kg/L)': e.kgPerLitre,
      'Supplier / Bill / Lot': e.supplierBillLot,
      'Product / Batch Made': e.productBatch,
      'Gap Centre (cm)': e.type === 'reading' ? e.gapCenterCm : '',
      'Gap Wall (cm)': e.type === 'reading' ? e.gapWallCm : '',
      'Gap Avg (cm)': e.type === 'reading' ? e.gapAvgCm : '',
      'Reading Litres': e.type === 'reading' ? e.calculatedLitres : '',
      'Book vs Reading Diff (kg)': e.type === 'reading' ? e.discrepancyKg : '',
      'Recorded By': e.userName,
      Source: e.source,
      Note: e.note,
    }));
    const wsLedger = XLSX.utils.json_to_sheet(ledgerData);
    XLSX.utils.book_append_sheet(wb, wsLedger, 'Entries History');

    XLSX.writeFile(
      wb,
      `KRAgro_TankStock_Report_${startDate}_to_${endDate}.xlsx`
    );
  };

  const applyDatePreset = (days: number) => {
    const end = new Date();
    const start = new Date(Date.now() - days * 24 * 3600 * 1000);
    setStartDate(start.toISOString().slice(0, 10));
    setEndDate(end.toISOString().slice(0, 10));
  };

  return (
    <div className="space-y-6">
      {/* Top Filter & Excel Export Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Stock Movement Reports & Excel Export
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Date-range stock reconciliation per tank and per material (Opening, Loaded, Used, Reading Difference, Closing).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl text-xs">
            <button
              type="button"
              onClick={() => applyDatePreset(7)}
              className="px-2.5 py-1.5 rounded-lg font-medium text-slate-700 hover:bg-white hover:shadow-sm cursor-pointer whitespace-nowrap"
            >
              Last 7 Days
            </button>
            <button
              type="button"
              onClick={() => applyDatePreset(30)}
              className="px-2.5 py-1.5 rounded-lg font-medium text-slate-700 hover:bg-white hover:shadow-sm cursor-pointer whitespace-nowrap"
            >
              Last 30 Days
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-xl border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900"
            />
            <span className="text-slate-400">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-xl border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900"
            />
          </div>

          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Export to Excel (.xlsx)</span>
          </button>
        </div>
      </div>

      {/* 1. Per-Material Date-Range Summary */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">
            Report by Material ({startDate} to {endDate})
          </h3>
          <span className="text-xs text-slate-500 font-mono">
            All weights in kg
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <th className="py-3 px-4 font-semibold">Material & Lot</th>
                <th className="py-3 px-4 font-semibold">Tanks</th>
                <th className="py-3 px-4 text-right font-semibold">Ref kg/L</th>
                <th className="py-3 px-4 text-right font-semibold">Opening (kg)</th>
                <th className="py-3 px-4 text-right font-semibold text-emerald-700">
                  + Loaded (kg)
                </th>
                <th className="py-3 px-4 text-right font-semibold text-blue-700">
                  - Used (kg)
                </th>
                <th className="py-3 px-4 text-right font-semibold">
                  Reading Diff (kg)
                </th>
                <th className="py-3 px-4 text-right font-semibold text-slate-900">
                  Closing Stock (kg)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
              {materialReportRows.map((r) => (
                <tr key={r.materialId} className="hover:bg-slate-50/80">
                  <td className="py-3 px-4 font-sans">
                    <div className="font-bold text-slate-900">
                      {r.materialName}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {r.code} · {r.lotNumber}
                    </div>
                  </td>
                  <td className="py-3 px-4 font-sans font-semibold text-slate-700">
                    {r.tankNames}
                  </td>
                  <td className="py-3 px-4 text-right text-slate-600">
                    {r.kgPerLitre.toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-right text-slate-700">
                    {r.openingKg.toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-right font-semibold text-emerald-700">
                    +{r.loadedKg.toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-right font-semibold text-blue-700">
                    -{r.usedKg.toLocaleString()}
                  </td>
                  <td
                    className={`py-3 px-4 text-right font-semibold ${
                      r.readingAdjustKg < 0
                        ? 'text-red-600'
                        : r.readingAdjustKg > 0
                        ? 'text-amber-700'
                        : 'text-slate-400'
                    }`}
                  >
                    {r.readingAdjustKg > 0 ? '+' : ''}
                    {r.readingAdjustKg.toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-slate-900 text-sm">
                    {r.closingKg.toLocaleString()} kg
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. Per-Tank Date-Range Summary */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">
            Report by Tank ({startDate} to {endDate})
          </h3>
          <span className="text-xs text-slate-500">
            Book vs Reading losses highlighted
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <th className="py-3 px-4 font-semibold">Tank</th>
                <th className="py-3 px-4 font-semibold">Material</th>
                <th className="py-3 px-4 text-right font-semibold">Opening (kg)</th>
                <th className="py-3 px-4 text-right font-semibold text-emerald-700">
                  + Loaded (kg)
                </th>
                <th className="py-3 px-4 text-right font-semibold text-blue-700">
                  - Used (kg)
                </th>
                <th className="py-3 px-4 text-right font-semibold">
                  Reading Diff / Loss (kg)
                </th>
                <th className="py-3 px-4 text-right font-semibold text-slate-900">
                  Closing Stock (kg)
                </th>
                <th className="py-3 px-4 text-right font-semibold">% Full Now</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
              {tankReportRows.map((r) => (
                <tr key={r.tankId} className="hover:bg-slate-50/80">
                  <td className="py-3 px-4 font-bold text-slate-900">
                    Tank {r.tankName}
                  </td>
                  <td className="py-3 px-4 font-sans text-slate-700">
                    {r.materialName}
                  </td>
                  <td className="py-3 px-4 text-right text-slate-700">
                    {r.openingKg.toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-right font-semibold text-emerald-700">
                    +{r.loadedKg.toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-right font-semibold text-blue-700">
                    -{r.usedKg.toLocaleString()}
                  </td>
                  <td
                    className={`py-3 px-4 text-right font-semibold ${
                      r.readingAdjustKg < 0
                        ? 'text-red-600'
                        : r.readingAdjustKg > 0
                        ? 'text-amber-700'
                        : 'text-slate-400'
                    }`}
                  >
                    {r.readingAdjustKg > 0 ? '+' : ''}
                    {r.readingAdjustKg.toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-slate-900 text-sm">
                    {r.closingKg.toLocaleString()} kg
                  </td>
                  <td className="py-3 px-4 text-right text-slate-600">
                    {r.fillPercent.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Filtered Entry Ledger */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-500" />
            <h3 className="text-sm font-bold text-slate-900">
              Detailed Entry Log ({filteredEntries.length} records)
            </h3>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <select
              value={filterTankId}
              onChange={(e) => setFilterTankId(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-1.5 bg-white text-slate-800"
            >
              <option value="all">All Tanks</option>
              {summaries.map((s) => (
                <option key={s.tank.id} value={s.tank.id}>
                  Tank {s.tank.name}
                </option>
              ))}
            </select>

            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-1.5 bg-white text-slate-800"
            >
              <option value="all">All Entry Types</option>
              <option value="load">1. Loaded into Tank</option>
              <option value="use">2. Used for Production</option>
              <option value="reading">3. Level Readings</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <th className="py-2.5 px-4 font-semibold">Date & Time</th>
                <th className="py-2.5 px-4 font-semibold">Tank</th>
                <th className="py-2.5 px-4 font-semibold">Type</th>
                <th className="py-2.5 px-4 text-right font-semibold">Weight (kg)</th>
                <th className="py-2.5 px-4 text-right font-semibold">kg/L</th>
                <th className="py-2.5 px-4 font-semibold">Details / Supplier / Batch / Gap</th>
                <th className="py-2.5 px-4 font-semibold">Staff / User</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredEntries.map((e) => {
                const tName =
                  summaries.find((s) => s.tank.id === e.tankId)?.tank.name ||
                  e.tankId;
                return (
                  <tr key={e.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {new Date(e.entryTimestamp).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-2.5 px-4 font-bold text-slate-900">
                      Tank {tName}
                    </td>
                    <td className="py-2.5 px-4 font-semibold">
                      {e.type === 'load' ? (
                        <span className="text-emerald-700">Loaded</span>
                      ) : e.type === 'use' ? (
                        <span className="text-blue-700">Used</span>
                      ) : (
                        <span className="text-amber-700">Level Reading</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                      {e.type === 'load' ? '+' : e.type === 'use' ? '-' : ''}
                      {e.kg.toLocaleString()} kg
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">
                      {e.kgPerLitre.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-4 text-slate-700">
                      {e.type === 'load' && (
                        <span>Supplier/Lot: {e.supplierBillLot}</span>
                      )}
                      {e.type === 'use' && (
                        <span>Batch: {e.productBatch}</span>
                      )}
                      {e.type === 'reading' && (
                        <span className="font-mono">
                          Gap: {e.gapAvgCm}cm (C:{e.gapCenterCm}/W:{e.gapWallCm}) ·{' '}
                          {e.calculatedLitres.toLocaleString()}L · Diff:{' '}
                          <strong
                            className={
                              e.discrepancyKg < 0
                                ? 'text-red-600'
                                : 'text-emerald-700'
                            }
                          >
                            {e.discrepancyKg > 0 ? '+' : ''}
                            {e.discrepancyKg}kg
                          </strong>
                        </span>
                      )}
                      {e.note && (
                        <span className="text-slate-400"> · {e.note}</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">
                      {e.userName}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
