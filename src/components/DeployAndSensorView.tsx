import React, { useState } from 'react';
import { TankStockSummary } from '../lib/tankMath.ts';
import {
  Radio,
  Server,
  CheckCircle2,
  Send,
  ExternalLink,
} from 'lucide-react';

interface DeployAndSensorViewProps {
  summaries: TankStockSummary[];
  onRefreshState: () => Promise<void>;
}

export const DeployAndSensorView: React.FC<DeployAndSensorViewProps> = ({
  summaries,
  onRefreshState,
}) => {
  const [sensorTankName, setSensorTankName] = useState<string>(
    summaries[0]?.tank.name || 'A'
  );
  const [sensorGapCenter, setSensorGapCenter] = useState<string>('110');
  const [sensorGapWall, setSensorGapWall] = useState<string>('118');
  const [sensorDensity, setSensorDensity] = useState<string>('0.78');
  const [sensorSending, setSensorSending] = useState(false);
  const [sensorResult, setSensorResult] = useState<string | null>(null);

  const handleSimulateSensorWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    setSensorSending(true);
    setSensorResult(null);
    try {
      const res = await fetch('/api/sensor-reading', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tankName: sensorTankName,
          gapCenterCm: Number(sensorGapCenter),
          gapWallCm: Number(sensorGapWall),
          kgPerLitre: Number(sensorDensity),
          note: 'Simulated ultrasonic roof sensor reading via API',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Sensor API error');
      }
      setSensorResult(
        `Sensor reading recorded for Tank ${data.tank}: ${data.calculation.litres.toLocaleString()} L (${data.calculation.kg.toLocaleString()} kg, Diff: ${
          data.calculation.discrepancyKg > 0 ? '+' : ''
        }${data.calculation.discrepancyKg} kg)`
      );
      await onRefreshState();
    } catch (err: unknown) {
      setSensorResult(
        err instanceof Error ? err.message : 'Failed to call sensor API'
      );
    } finally {
      setSensorSending(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Automatic Level Sensor API Integration & Live Simulator */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Radio className="w-5 h-5 text-sky-600" />
              <h2 className="text-lg font-bold text-slate-900">
                Automatic Tank Level Sensor API (Ready for IoT Sensors)
              </h2>
            </div>
            <p className="text-xs text-slate-600 mt-1 max-w-2xl">
              When you install ultrasonic or laser distance sensors on top of the tanks later, point them to <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">POST /api/sensor-reading</code>. The server uses the exact same 1 cm layer calculation and updates all phones live.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Live Sensor Webhook Simulator */}
          <form
            onSubmit={handleSimulateSensorWebhook}
            className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3.5"
          >
            <h3 className="text-xs font-bold text-slate-900">
              Test Live Sensor Reading Now
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Tank Name
                </label>
                <select
                  value={sensorTankName}
                  onChange={(e) => setSensorTankName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-900"
                >
                  {summaries.map((s) => (
                    <option key={s.tank.id} value={s.tank.name}>
                      Tank {s.tank.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Centre Gap (cm)
                </label>
                <input
                  type="number"
                  value={sensorGapCenter}
                  onChange={(e) => setSensorGapCenter(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Wall Gap (cm)
                </label>
                <input
                  type="number"
                  value={sensorGapWall}
                  onChange={(e) => setSensorGapWall(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Density (kg/L)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={sensorDensity}
                  onChange={(e) => setSensorDensity(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono text-slate-900"
                />
              </div>
            </div>

            {sensorResult && (
              <div className="flex items-center gap-2 rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-xs font-medium text-sky-900">
                <CheckCircle2 className="w-4 h-4 text-sky-600 shrink-0" />
                <span>{sensorResult}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={sensorSending}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-500 transition-colors cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {sensorSending
                  ? 'Sending Sensor Reading...'
                  : 'Send Test Sensor Reading to API'}
              </span>
            </button>
          </form>

          {/* Example JSON Payload for Sensor Technician */}
          <div className="rounded-xl bg-slate-900 text-slate-200 p-4 font-mono text-xs space-y-2 overflow-x-auto">
            <div className="text-slate-400 font-sans text-[11px] font-semibold">
              Example HTTP Request for Hardware Technician (ESP32 / PLC / Gateway):
            </div>
            <pre className="text-[11px] leading-relaxed text-amber-300">
{`POST /api/sensor-reading
Content-Type: application/json

{
  "tankName": "A",
  "gapCenterCm": 110,
  "gapWallCm": 118,
  "kgPerLitre": 0.78,
  "note": "Ultrasonic Sensor #1"
}`}
            </pre>
          </div>
        </div>
      </div>

      {/* 2. Step-by-Step Deployment Guide for Non-Programmers (GitHub + Render + Neon Postgres) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-amber-600" />
          <h2 className="text-lg font-bold text-slate-900">
            Step-by-Step Guide: Host on GitHub + Render + Neon Postgres
          </h2>
        </div>
        <p className="text-xs text-slate-600 max-w-3xl">
          Follow these 4 simple steps (no programming needed) to host Tank Stock on your own GitHub, Render, and Neon accounts—just like your other factory apps.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 p-4 space-y-2">
            <div className="text-xs font-bold text-amber-700">
              01. Create Your Free Neon Postgres Database
            </div>
            <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-600 leading-relaxed">
              <li>
                Log in to <strong>neon.tech</strong> and click{' '}
                <strong>New Project</strong>. Name it{' '}
                <code className="font-mono bg-slate-100 px-1 rounded">
                  kr-agro-tank-stock
                </code>
                .
              </li>
              <li>
                On the Neon dashboard, switch the connection details view from
                &ldquo;Connection string&rdquo; to{' '}
                <strong>Parameters only</strong>.
              </li>
              <li>
                Note down your 4 values: <strong>Host</strong> (`PGHOST`),{' '}
                <strong>Database name</strong> (`PGDATABASE`),{' '}
                <strong>User</strong> (`PGUSER`), and <strong>Password</strong>{' '}
                (`PGPASSWORD`).
              </li>
            </ol>
          </div>

          <div className="rounded-xl border border-slate-200 p-4 space-y-2">
            <div className="text-xs font-bold text-amber-700">
              02. Save Code to Your GitHub Account
            </div>
            <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-600 leading-relaxed">
              <li>
                Click the <strong>Export / Download</strong> or{' '}
                <strong>GitHub</strong> button in the top bar of AI Studio.
              </li>
              <li>
                Choose a repository name such as{' '}
                <code className="font-mono bg-slate-100 px-1 rounded">
                  tank-stock-kr-agro
                </code>{' '}
                and save it to your GitHub account.
              </li>
            </ol>
          </div>

          <div className="rounded-xl border border-slate-200 p-4 space-y-2">
            <div className="text-xs font-bold text-amber-700">
              03. Connect GitHub to Render Web Service
            </div>
            <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-600 leading-relaxed">
              <li>
                Open <strong>dashboard.render.com</strong>, click{' '}
                <strong>New +</strong> → <strong>Web Service</strong>, and
                select your <code className="font-mono bg-slate-100 px-1 rounded">tank-stock-kr-agro</code> repository.
              </li>
              <li>
                Set <strong>Build Command</strong> to:{' '}
                <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded font-semibold">
                  npm install && npm run build
                </code>
              </li>
              <li>
                Set <strong>Start Command</strong> to:{' '}
                <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded font-semibold">
                  npx tsx server.ts
                </code>
              </li>
            </ol>
          </div>

          <div className="rounded-xl border border-slate-200 p-4 space-y-2">
            <div className="text-xs font-bold text-amber-700">
              04. Add Environment Variables on Render & Install on Phones
            </div>
            <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-600 leading-relaxed">
              <li>
                In Render → <strong>Environment</strong>, add your Neon
                database details:
                <div className="mt-1 font-mono text-[11px] bg-slate-50 p-2 rounded border border-slate-200 space-y-0.5">
                  <div>SQL_HOST = your-neon-host.neon.tech</div>
                  <div>SQL_DB_NAME = neondb</div>
                  <div>SQL_USER = your_neon_user</div>
                  <div>SQL_PASSWORD = your_neon_password</div>
                  <div>SQL_ADMIN_USER = your_neon_user</div>
                  <div>SQL_ADMIN_PASSWORD = your_neon_password</div>
                </div>
              </li>
              <li>
                Click <strong>Deploy Web Service</strong>. Once live, open your
                Render link on each staff phone and tap{' '}
                <strong>Install App</strong> to add Tank Stock to the home
                screen!
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
};
