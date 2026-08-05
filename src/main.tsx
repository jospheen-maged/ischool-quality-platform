import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './design-overrides.css';
import './workspace-redesign.css';
import './directory-polish.css';
import './tutor-polish.css';

type ErrorBoundaryState = { error: Error | null };

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('B2B Offline application error', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="fatal-screen">
          <section className="fatal-card">
            <div className="fatal-mark">iS</div>
            <p className="eyebrow">B2B Offline Quality</p>
            <h1>The workspace could not start</h1>
            <p>{this.state.error.message || 'An unexpected browser error occurred.'}</p>
            <button className="button button-primary" onClick={() => window.location.reload()}>
              Reload workspace
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
