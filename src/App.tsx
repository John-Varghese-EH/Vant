import React, { useState, useEffect } from 'react';
import { SetupWizard } from './components/SetupWizard';
import { HostConsole } from './components/HostConsole';
import { ClientTerminal } from './components/ClientTerminal';
import { SplashScreen } from './components/SplashScreen';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { ToastProvider } from './components/common/Toast';
import { useTheme } from './hooks/useTheme';

export const App: React.FC = () => {
  useTheme();
  const [role, setRole] = useState<'host' | 'client' | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const connectUrl = searchParams.get('connect') || searchParams.get('tunnel') || searchParams.get('host');
      const token = searchParams.get('token');

      if (connectUrl || token) {
        if (connectUrl) localStorage.setItem('vant_auto_connect', connectUrl);
        if (token) localStorage.setItem('vant_auto_token', token);
        localStorage.setItem('vant_role', 'client');
        setRole('client');
        setIsReady(true);
        return;
      }
    } catch (e) {
      console.warn('Failed to parse URL query parameters:', e);
    }

    const savedRole = (localStorage.getItem('vant_role') || localStorage.getItem('gc_role')) as 'host' | 'client' | null;
    if (savedRole) {
      localStorage.setItem('vant_role', savedRole);
      setRole(savedRole);
    }
    setIsReady(true);
  }, []);

  const handleSetupComplete = (selectedRole: 'host' | 'client') => {
    localStorage.setItem('vant_role', selectedRole);
    localStorage.removeItem('gc_role');
    setRole(selectedRole);
  };

  const handleResetRole = () => {
    localStorage.removeItem('vant_role');
    localStorage.removeItem('vant_auto_connect');
    localStorage.removeItem('vant_auto_token');
    localStorage.removeItem('gc_role');
    localStorage.removeItem('gc_auto_connect');
    localStorage.removeItem('gc_auto_token');
    setRole(null);
  };

  if (!isReady) {
    return null;
  }

  return (
    <ToastProvider>
      {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}

      {!role && (
        <ErrorBoundary scope="SetupWizard" onReset={() => setRole(null)}>
          <SetupWizard onComplete={handleSetupComplete} />
        </ErrorBoundary>
      )}
      {role === 'host' && (
        <ErrorBoundary scope="HostConsole" onReset={handleResetRole}>
          <HostConsole onResetRole={handleResetRole} />
        </ErrorBoundary>
      )}
      {role === 'client' && (
        <ErrorBoundary scope="ClientTerminal" onReset={handleResetRole}>
          <ClientTerminal onResetRole={handleResetRole} />
        </ErrorBoundary>
      )}
    </ToastProvider>
  );
};

export default App;
