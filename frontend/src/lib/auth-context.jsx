import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  fetchBootstrap,
  loginRequest,
  logoutRequest,
  setupOwner,
  acceptInvite,
} from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const bs = await fetchBootstrap();
      setNeedsSetup(!!bs.needsSetup);
      setUser(bs.user || null);
    } catch (err) {
      setUser(null);
      setNeedsSetup(false);
      console.error('auth bootstrap failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (credentials) => {
    const { user } = await loginRequest(credentials);
    setUser(user);
    setNeedsSetup(false);
    return user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      setUser(null);
      await refresh();
    }
  }, [refresh]);

  const doSetup = useCallback(async (form) => {
    const { user } = await setupOwner(form);
    setUser(user);
    setNeedsSetup(false);
    return user;
  }, []);

  const acceptInviteFlow = useCallback(async (token, form) => {
    const { user } = await acceptInvite(token, form);
    setUser(user);
    setNeedsSetup(false);
    return user;
  }, []);

  const can = useCallback(
    (permission) => {
      if (!user) return false;
      if (user.role === 'owner') return true;
      if (user.role === 'operator') return permission !== 'admin';
      return permission === 'read';
    },
    [user]
  );

  const value = useMemo(
    () => ({
      loading,
      user,
      needsSetup,
      isAuthed: !!user,
      can,
      login,
      logout,
      setupOwner: doSetup,
      acceptInvite: acceptInviteFlow,
      refresh,
    }),
    [loading, user, needsSetup, can, login, logout, doSetup, acceptInviteFlow, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
