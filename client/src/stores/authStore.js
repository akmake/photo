import { create } from 'zustand';
import api from '../services/api';

export const useAuthStore = create((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  checkAuth: async () => {
    try {
      set({ isLoading: true });
      const { data } = await api.get('/auth/me');
      set({ user: data.data.user, isAuthenticated: true, isLoading: false });
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  register: async (userData) => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await api.post('/auth/register', userData);
      set({ user: data.data.user, isAuthenticated: true, isLoading: false });
      return true;
    } catch (err) {
      set({ error: err.response?.data?.message || 'שגיאה בהרשמה', isLoading: false });
      return false;
    }
  },

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await api.post('/auth/login', { email, password });
      set({ user: data.data.user, isAuthenticated: true, isLoading: false });
      return true;
    } catch (err) {
      set({ error: err.response?.data?.message || 'שגיאה בהתחברות', isLoading: false });
      return false;
    }
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
      set({ user: null, isAuthenticated: false });
    } catch (err) {
      console.error('Logout error', err);
    }
  },
}));
