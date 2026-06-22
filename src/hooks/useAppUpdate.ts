import { useEffect, useState } from 'react';

export function useAppUpdate() {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check localStorage for pending update on mount
    const updateAvailable = localStorage.getItem('updateAvailable') === 'true';
    const isDismissed = sessionStorage.getItem('updateDismissed') === 'true';

    if (updateAvailable && !isDismissed) {
      setHasUpdate(true);
    }

    // Listen for SW messages about new updates
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'UPDATE_AVAILABLE') {
        setHasUpdate(true);
        sessionStorage.removeItem('updateDismissed'); // Reset dismissal on new version
      }
    };

    navigator.serviceWorker?.addEventListener('message', handleMessage);

    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleMessage);
    };
  }, []);

  const dismissUpdate = () => {
    sessionStorage.setItem('updateDismissed', 'true');
    setDismissed(true);
    setHasUpdate(false);
  };

  const performUpdate = () => {
    localStorage.removeItem('updateAvailable');
    sessionStorage.removeItem('updateDismissed');
    // Reload after 2 seconds to let user see the message
    setTimeout(() => {
      window.location.reload();
    }, 2000);
  };

  return { hasUpdate: hasUpdate && !dismissed, dismissUpdate, performUpdate };
}
