import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
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
      : 'qc';

  return {
    id: user.id,
    full_name: String(user.user_metadata?.full_name || user.email?.split('@')[0] || 'iSchool User'),
    email: user.email ?? null,
    role,
    tutor_id: null,
    is_active: true,
  };
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  async function loadProfile(user: User) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, tutor_id, is_active')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      console.warn('Profile lookup failed; using safe authenticated fallback.', error);
      setAuthError('Your account is signed in, but the profile record could not be loaded.');
      setProfile(fallbackProfile(user));
      return;
    }

    setProfile(data ? data as Profile : fallbackProfile(user));
  }

  async function refreshProfile() {
    if (!session?.user) return;
    await loadProfile(session.user);
  }

  useEffect(() => {
    let mounted = true;

    async function initialise() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!mounted) return;
        setSession(data.session);
        if (data.session?.user) await loadProfile(data.session.user);
      } catch (caught) {
        console.error('Authentication startup failed.', caught);
        if (mounted) setAuthError(caught instanceof Error ? caught.message : 'Unable to initialise authentication.');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void initialise();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setProfile(null);
      setAuthError('');

      window.setTimeout(() => {
        if (!mounted) return;
        if (nextSession?.user) {
          void loadProfile(nextSession.user).finally(() => {
            if (mounted) setLoading(false);
          });
        } else {
          setLoading(false);
        }
      }, 0);
    });

    return () => {
      mounted = false;
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
