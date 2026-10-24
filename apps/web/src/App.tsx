import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { useSocketSync } from './hooks/useSocketSync';
import { useVoiceConnection } from './hooks/useVoiceConnection';
import { AppBar } from './components/AppBar';
import { refreshAccount } from './lib/account';
import { AccountPage } from './pages/AccountPage';
import { AccountsAdminPage } from './pages/AccountsAdminPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { SoundsPage } from './pages/SoundsPage';
import { RoomPage } from './pages/RoomPage';

export function App() {
  useSocketSync();
  useVoiceConnection();
  useEffect(() => void refreshAccount(), []);
  return (
    <BrowserRouter>
      {/* App bar, the page (taking the room left), footer: one screen high at least. */}
      <div className="flex min-h-dvh flex-col">
        <AppBar />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/r/:code" element={<RoomPage />} />
          <Route path="/sounds" element={<SoundsPage />} />
          {/* The old library admin page's address. */}
          <Route path="/admin" element={<Navigate to="/sounds" replace />} />
          <Route path="/admin/accounts" element={<AccountsAdminPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
        <footer className="border-t border-line py-4 text-center text-xs text-subtle">
          <a
            href="https://github.com/Titch22/can-you-repeat-please"
            target="_blank"
            rel="noreferrer"
            className="underline-offset-2 hover:text-ink hover:underline"
          >
            Can You Repeat Please? on GitHub
          </a>
        </footer>
      </div>
    </BrowserRouter>
  );
}
