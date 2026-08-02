import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type PropsWithChildren,
} from 'react';

type NavigateOptions = {
  replace?: boolean;
  state?: unknown;
};

type RouterContextValue = {
  pathname: string;
  searchParams: URLSearchParams;
  state: unknown;
  navigate: (to: string, options?: NavigateOptions) => void;
};

const RouterContext = createContext<RouterContextValue | undefined>(undefined);

export function RouterProvider({ children }: PropsWithChildren) {
  const [locationKey, setLocationKey] = useState(() => `${window.location.pathname}${window.location.search}${window.location.hash}`);

  useEffect(() => {
    const handlePopState = () => {
      setLocationKey(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((to: string, options: NavigateOptions = {}) => {
    const method = options.replace ? 'replaceState' : 'pushState';
    window.history[method](options.state ?? null, '', to);
    setLocationKey(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const value = useMemo<RouterContextValue>(() => ({
    pathname: window.location.pathname,
    searchParams: new URLSearchParams(window.location.search),
    state: window.history.state,
    navigate,
  }), [locationKey, navigate]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  const context = useContext(RouterContext);
  if (!context) throw new Error('useRouter must be used inside RouterProvider');
  return context;
}

export function useNavigate() {
  return useRouter().navigate;
}

type AppLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  to: string;
  exact?: boolean;
  activeClassName?: string;
};

export function AppLink({
  to,
  exact = false,
  activeClassName = 'active',
  className = '',
  onClick,
  children,
  ...rest
}: AppLinkProps) {
  const { pathname, navigate } = useRouter();
  const targetPath = new URL(to, window.location.origin).pathname;
  const isActive = exact ? pathname === targetPath : pathname === targetPath || pathname.startsWith(`${targetPath}/`);
  const resolvedClassName = [className, isActive ? activeClassName : ''].filter(Boolean).join(' ');

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
      || rest.target === '_blank'
    ) {
      return;
    }

    event.preventDefault();
    navigate(to);
  }

  return (
    <a href={to} className={resolvedClassName} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
