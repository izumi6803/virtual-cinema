import { useCallback, useEffect, useState } from 'react';

export function useInstallPrompt() {
  const [prompt, setPrompt] = useState(null);

  useEffect(() => {
    const onPrompt = (event) => {
      event.preventDefault();
      setPrompt(event);
    };
    const onInstalled = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!prompt) return;
    prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice?.outcome === 'accepted') setPrompt(null);
  }, [prompt]);

  return { canInstall: Boolean(prompt), install };
}
