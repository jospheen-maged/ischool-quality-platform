import { createContext, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile, UserRole } from '../types';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  authError: string;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const roles: UserRole[] = ['super_admin', 'admin', 'qtl', 'qc', 'tutor'];

function fallbackProfile(user: User): Profile {
  const metadataRole = user.user_metadata?.role as UserRole | undefined;
  const role: UserRole = user.email?.toLowerCase() === 'josphen.maged@ischooltech.com'
    ? 'super_admin'
    : metadataRole && roles.includes(metadataRole)
      ? metadataRole
      : 'tutor';

  return {
    id: user.id,
    full_name: String(user.user_metadata?.full_name || user.email?.split('@')[0] || 'iSchool User'),
    email: user.email ?? null,
    role,
    tutor_id: typeof user.user_metadata?.tutor_id === 'string' ? user.user_metadata.tutor_id : null,
    is_active: true,
    permissions: {},
  };
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  const activeUserId = useRef<string | null>(null);
  const profileRequest = useRef(0);
  const mountedRef = useRef(false);

  async function loadProfile(user: User) {
    const request = ++profileRequest.current;
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, tutor_id, is_active, permissions')
      .eq('id', user.id)
      .maybeSingle();

    // Ignore an old lookup after sign-out, an account switch, or a newer lookup.
    if (!mountedRef.current || activeUserId.current !== user.id || request !== profileRequest.current) return;

    if (error) {
      console.warn('Profile lookup failed; using least-privilege authenticated fallback.', error);
      setAuthError('Your account is signed in, but the profile record could not be loaded.');
      setProfile((current) => current?.id === user.id ? current : fallbackProfile(user));
      return;
    }

    setProfile(data ? { ...data, permissions: data.permissions ?? {} } as Profile : fallbackProfile(user));
  }

  async function refreshProfile() {
    if (!session?.user) return;
    await loadProfile(session.user);
  }

  useEffect(() => {
    let mounted = true;
    let authEventReceived = false;
    mountedRef.current = true;

    function applySession(nextSession: Session | null) {
      if (!mounted) return;
      const nextUserId = nextSession?.user.id ?? null;
      const identityChanged = activeUserId.current !== nextUserId;
      activeUserId.current = nextUserId;
      setSession(nextSession);
      setAuthError('');

      if (!nextSession) {
        ++profileRequest.current;
        setProfile(null);
        setLoading(false);
        return;
      }

      // A token refresh or tab refocus must not unmount the current page.
      // Only clear the profile when the signed-in identity actually changes.
      if (identityChanged) {
        ++profileRequest.current;
        setProfile(null);
        setLoading(true);
      }

      window.setTimeout(() => {
        if (!mounted || activeUserId.current !== nextUserId) return;
        void loadProfile(nextSession.user).catch((caught) => {
          if (mounted && activeUserId.current === nextUserId) {
            setAuthError(caught instanceof Error ? caught.message : 'Unable to load your profile.');
          }
        }).finally(() => {
          if (mounted && activeUserId.current === nextUserId) setLoading(false);
        });
      }, 0);
    }

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      authEventReceived = true;
      applySession(nextSession);
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      // An auth event is newer than this startup read and takes precedence.
      if (!mounted || authEventReceived) return;
      if (error) throw error;
      applySession(data.session);
    }).catch((caught) => {
      if (!mounted || authEventReceived) return;
      setAuthError(caught instanceof Error ? caught.message : 'Unable to initialise authentication.');
      setLoading(false);
    });

    return () => {
      mounted = false;
      mountedRef.current = false;
      ++profileRequest.current;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      authError,
      signIn: async (email, password) => {
        setAuthError('');
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      signOut: async () => {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        setSession(null);
        setProfile(null);
      },
      refreshProfile,
    }),
    [session, profile, loading, authError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
