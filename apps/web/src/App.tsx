import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { useSocketSync } from './hooks/useSocketSync';
import { useVoiceConnection } from './hooks/useVoiceConnection';
import { refreshAccount } from './lib/account';
import { AccountPage } from './pages/AccountPage';
import { AccountsAdminPage } from './pages/AccountsAdminPage';
import { HomePage } from './pages/HomePage';
import { AdminPage } from './pages/AdminPage';
import { LoginPage } from './pages/LoginPage';
import { RoomPage } from './pages/RoomPage';

export function App() {
  useSocketSync();
  useVoiceConnection();
  useEffect(() => void refreshAccount(), []);
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/r/:code" element={<RoomPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/accounts" element={<AccountsAdminPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </BrowserRouter>
  );
}
