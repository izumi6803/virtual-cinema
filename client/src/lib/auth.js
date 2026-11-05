import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../net/api.js';
import { connectSocket, socket } from '../net/socket.js';

const TOKEN_KEY = 'vc:token';

export function useAuth() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(token));
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const clear = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
    setUser(null);
    setLoading(false);
    socket.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setUser(null);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    api('/api/auth/me', { token })
      .then((data) => {
        if (cancelled) return;
        setUser(data.user);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) clear();
      });
    return () => {
      cancelled = true;
    };
  }, [token, clear]);

  useEffect(() => {
    if (token) connectSocket(token);
  }, [token]);

  useEffect(() => {
    const onError = (error) => {
      if (error?.message === 'unauthorized') clear();
    };
    socket.on('connect_error', onError);
    return () => socket.off('connect_error', onError);
  }, [clear]);

  const login = useCallback(async (email, password) => {
    const data = await api('/api/auth/login', { method: 'POST', body: { email, password } });
    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
    setToken(data.token);
  }, []);

  const register = useCallback(async (email, password, name) => {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: { email, password, name },
    });
    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
    setToken(data.token);
  }, []);

  const logout = useCallback(async () => {
    const current = tokenRef.current;
    clear();
    if (current) api('/api/auth/logout', { method: 'POST', token: current }).catch(() => {});
  }, [clear]);

  return { token, user, loading, login, register, logout };
}
