import { useState } from 'react';
import { useAppUpdate } from '../hooks/useAppUpdate';

export function UpdateAvailableBanner() {
  const { hasUpdate, dismissUpdate, performUpdate } = useAppUpdate();
  const [isReloading, setIsReloading] = useState(false);

  if (!hasUpdate) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-3">
      <div className="flex items-center justify-between gap-3 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 1119.414 6.414 1 1 0 01-1.414-1.414A5.002 5.002 0 104.659 7.1V5a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 011-1h2a1 1 0 110 2H7a1 1 0 01-1-1V3a1 1 0 01-1-1zm5 9a1 1 0 10-2 0 1 1 0 002 0z" clipRule="evenodd" />
          </svg>
          <span className="text-sm font-medium text-white">
            {isReloading ? 'Updates loading...' : 'Updates ready to improve your journey'}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={dismissUpdate}
            disabled={isReloading}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white disabled:opacity-50 transition-colors"
          >
            Later
          </button>
          <button
            onClick={() => {
              setIsReloading(true);
              performUpdate();
            }}
            disabled={isReloading}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-white text-emerald-600 hover:bg-white/90 disabled:opacity-50 transition-colors"
          >
            {isReloading ? 'Refreshing...' : 'Refresh Now'}
          </button>
        </div>
      </div>
    </div>
  );
}
