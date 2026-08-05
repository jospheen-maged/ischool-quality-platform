import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './design-overrides.css';
import './workspace-redesign.css';
import './directory-polish.css';
import './tutor-polish.css';
import './tutor-portal.css';
import './model-settings.css';
import './objection-workflow.css';

type ErrorBoundaryState = { error: Error | null };

const chunkReloadKey = 'b2b-latest-bundle-reload';

function isStaleChunkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk .* failed|ChunkLoadError/i.test(message);
}

function reloadLatestBundle() {
  const previousAttempt = Number(window.sessionStorage.getItem(chunkReloadKey) || 0);
  if (Date.now() - previousAttempt < 15_000) return false;

  window.sessionStorage.setItem(chunkReloadKey, String(Date.now()));
  const url = new URL(window.location.href);
  url.searchParams.set('_workspace_refresh', String(Date.now()));
  window.location.replace(url.toString());
  return true;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('B2B Offline application error', error, info);
    if (isStaleChunkError(error)) reloadLatestBundle();
  }

  render() {
    if (this.state.error) {
      const isUpdating = isStaleChunkError(this.state.error);
      return (
        <main className="fatal-screen">
          <section className="fatal-card">
            <div className="fatal-mark">iS</div>
            <p className="eyebrow">B2B Offline Quality</p>
            <h1>{isUpdating ? 'Updating the workspace' : 'The workspace could not start'}</h1>
            <p>{isUpdating ? 'A newer version was published. Reloading the latest workspace files…' : (this.state.error.message || 'An unexpected browser error occurred.')}</p>
            <button className="button button-primary" onClick={() => isUpdating ? reloadLatestBundle() : window.location.reload()}>
              {isUpdating ? 'Load latest version' : 'Reload workspace'}
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Application root element is missing.');

createRoot(root).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

window.setTimeout(() => window.sessionStorage.removeItem(chunkReloadKey), 15_000);
