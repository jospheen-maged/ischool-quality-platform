import { useLayoutEffect, useRef, useState, type SetStateAction } from 'react';
import { useAuth } from '../auth/AuthProvider';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Keep newly added default fields when restoring an older draft.
function restore<T extends Record<string, unknown>>(defaults: T, saved: unknown): T {
  if (!isRecord(saved)) return defaults;
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as Array<keyof T>) {
    const value = saved[String(key)];
    const fallback = defaults[key];
    if (Array.isArray(fallback)) {
      if (Array.isArray(value)) result[key] = value as T[typeof key];
    } else if (isRecord(fallback)) {
      if (isRecord(value)) {
        result[key] = (Object.keys(fallback).length ? restore(fallback, value) : value) as T[typeof key];
      }
    } else if (typeof value === typeof fallback) {
      result[key] = value as T[typeof key];
    }
  }
  return result;
}

export function useFormDraft<T extends Record<string, unknown>>(form: string, defaults: T) {
  const { user } = useAuth();
  // ProtectedRoute remounts the form on an account change. Never share drafts
  // between users or between the session and final-project forms.
  const key = `b2b-offline-draft:v1:${user?.id}:${form}`;
  const [initial] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return { values: defaults, restored: false, failed: false };
      const saved: unknown = JSON.parse(raw);
      if (!isRecord(saved) || saved.version !== 1) return { values: defaults, restored: false, failed: false };
      return { values: restore(defaults, saved.values), restored: true, failed: false };
    } catch {
      return { values: defaults, restored: false, failed: true };
    }
  });
  const [values, setValues] = useState(initial.values);
  const [storageError, setStorageError] = useState(initial.failed);
  const [saved, setSaved] = useState(initial.restored);
  const shouldSave = useRef(initial.restored);

  // Synchronous after each committed change: no timer to lose on tab suspension,
  // browser reload, or route unmount. The payload contains only form input.
  useLayoutEffect(() => {
    if (!shouldSave.current || !user) return;
    try {
      window.localStorage.setItem(key, JSON.stringify({ version: 1, values }));
      setStorageError(false);
      setSaved(true);
    } catch {
      setStorageError(true);
      setSaved(false);
    }
  }, [key, user?.id, values]);

  function setField<K extends keyof T>(field: K, update: SetStateAction<T[K]>) {
    shouldSave.current = true;
    setValues((current) => ({
      ...current,
      [field]: typeof update === 'function'
        ? (update as (previous: T[K]) => T[K])(current[field])
        : update,
    }));
  }

  function clearDraft(nextValues?: T) {
    shouldSave.current = false;
    try {
      window.localStorage.removeItem(key);
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
    setSaved(false);
    if (nextValues) setValues(nextValues);
  }

  return { values, setField, clearDraft, saved, storageError };
}
