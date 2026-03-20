import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createDb } from '../services/db';

export const useDb = () => {
  const { getApiToken, authMode } = useAuth();
  return useMemo(() => createDb(getApiToken, authMode), [getApiToken, authMode]);
};
