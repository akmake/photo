import { Routes, Route } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './auth';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import Portal from './pages/Portal';
import ClientGallery from './pages/ClientGallery';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/portal" element={<RequireAuth><Portal /></RequireAuth>} />
        {/* The secure client link: /g/<token> */}
        <Route path="/g/:token" element={<ClientGallery />} />
      </Routes>
    </AuthProvider>
  );
}
