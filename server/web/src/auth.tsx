// Tiny auth context: who is logged in, and guards for protected routes.
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { api, getToken, setToken } from './api';

type Me = { account: string; email: string; name: string; is_admin: boolean };

type AuthCtx = {
  me: Me | null;
  loading: boolean;
  signIn: (token: string) => Promise<void>;
  signOut: () => void;
};

const Ctx = createContext<AuthCtx>({ me: null, loading: true, signIn: async () => {}, signOut: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    if (!getToken()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api.me());
    } catch {
      setToken(null);
      setMe(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function signIn(token: string) {
    setToken(token);
    setLoading(true);
    await refresh();
  }

  function signOut() {
    setToken(null);
    setMe(null);
  }

  return <Ctx.Provider value={{ me, loading, signIn, signOut }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <div className="wrap" style={{ padding: 80, textAlign: 'center' }}>טוען…</div>;
  if (!me) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
