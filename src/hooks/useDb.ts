import { useMemo } from 'react';
import { useAuth } from '@clerk/react';
import { createDb } from '../services/db';

export const useDb = () => {
  const { getToken } = useAuth();
  return useMemo(() => createDb(getToken), [getToken]);
};
