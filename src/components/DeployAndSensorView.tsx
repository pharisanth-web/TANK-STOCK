import React, { useState, useEffect } from 'react';
import {
  Server,
  Download,
  Copy,
  FileText,
  Check,
} from 'lucide-react';

export const DeployAndSensorView: React.FC = () => {
  const [masterPromptText, setMasterPromptText] = useState<string>('');
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  useEffect(() => {
    fetch('/TANK_STOCK_MASTER_PROMPT.md')
      .then((r) => r.text())
      .then((txt) => setMasterPromptText(txt))
      .catch(() => {});
  }, []);

  const handleCopyPrompt = async () => {
    if (!masterPromptText) return;
    await navigator.clipboard.writeText(masterPromptText);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2500);
  };

  const handleDownloadPromptFile = (ext: 'md' | 'txt') => {
    const content = masterPromptText || 'Master Prompt loading...';
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TANK_STOCK_MASTER_PROMPT.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* 1. Complete Master Prompt & Blueprint File Download */}
      <div className="bg-white rounded-2xl border border-amber-300 shadow-sm p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-amber-600" />
              <h2 className="text-lg font-bold text-slate-900">
                Complete App Master Prompt &amp; Specification File
              </h2>
            </div>
            <p className="text-xs text-slate-600 mt-1 max-w-2xl">
              Download or copy the complete end-to-end prompt file (<code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">TANK_STOCK_MASTER_PROMPT.md</code>) containing every requirement, 1 cm layer formula, 3D tank specification, database schema, and PWA setup needed to recreate this full app.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleDownloadPromptFile('txt')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download Prompt (.txt)</span>
            </button>
            <button
              type="button"
              onClick={() => handleDownloadPromptFile('md')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download Prompt (.md)</span>
            </button>
            <button
              type="button"
              onClick={handleCopyPrompt}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              {copiedPrompt ? (
                <>
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span className="text-emerald-700">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Copy Full Prompt</span>
                </>
              )}
            </button>
          </div>
        </div>

        {masterPromptText && (
          <pre className="max-h-64 overflow-y-auto rounded-xl bg-slate-900 text-slate-200 p-4 text-[11px] font-mono leading-relaxed whitespace-pre-wrap border border-slate-800">
            {masterPromptText}
          </pre>
        )}
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
              04. Add Environment Variables on Render &amp; Install on Phones
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
