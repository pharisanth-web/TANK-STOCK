import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={async () => {
          if (isInstallable) {
            await install();
          } else {
            setShowGuide(true);
          }
        }}
        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        title="Install Tank Stock on Phone or Computer"
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span>Install App</span>
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-amber-600" />
                <h3 className="text-base font-bold text-slate-900">
                  Install Tank Stock on Your Phone
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm text-slate-700">
              {isIOS ? (
                <div className="space-y-2 rounded-xl bg-slate-50 p-4 border border-slate-200">
                  <p className="font-semibold text-slate-900">
                    For iPhone / iPad (Safari):
                  </p>
                  <ol className="list-decimal list-inside space-y-1.5 text-slate-600">
                    <li>
                      Tap the <strong>Share</strong> button at the bottom of
                      Safari.
                    </li>
                    <li>
                      Scroll down and tap <strong>Add to Home Screen</strong>.
                    </li>
                    <li>
                      Tap <strong>Add</strong> in the top-right corner. Tank
                      Stock will open full-screen like a native app.
                    </li>
                  </ol>
                </div>
              ) : (
                <div className="space-y-2 rounded-xl bg-slate-50 p-4 border border-slate-200">
                  <p className="font-semibold text-slate-900">
                    For Android Phone or Desktop Chrome:
                  </p>
                  <ol className="list-decimal list-inside space-y-1.5 text-slate-600">
                    <li>
                      Open this app in <strong>Google Chrome</strong> on your
                      phone or computer (outside the preview frame if testing).
                    </li>
                    <li>
                      Tap the <strong>3-dot menu</strong> in the top-right
                      corner and choose <strong>Add to Home screen</strong> or{' '}
                      <strong>Install app</strong>.
                    </li>
                    <li>
                      On iPhone Safari, tap <strong>Share</strong> and select{' '}
                      <strong>Add to Home Screen</strong>.
                    </li>
                  </ol>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
};
