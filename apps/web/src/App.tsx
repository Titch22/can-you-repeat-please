import { BrowserRouter, Route, Routes } from 'react-router';
import { useSocketSync } from './hooks/useSocketSync';
import { useVoiceConnection } from './hooks/useVoiceConnection';
import { HomePage } from './pages/HomePage';
import { RoomPage } from './pages/RoomPage';

export function App() {
  useSocketSync();
  useVoiceConnection();
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/r/:code" element={<RoomPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </BrowserRouter>
  );
}
