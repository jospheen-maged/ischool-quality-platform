// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { RouterProvider } from './router';
import { useFormDraft } from './useFormDraft';

const auth = vi.hoisted(() => ({
  listener: null as null | ((event: string, session: unknown) => void),
  profileLookup: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: auth.getSession,
      onAuthStateChange: (listener: typeof auth.listener) => {
        auth.listener = listener;
        return { data: { subscription: { unsubscribe() { auth.listener = null; } } } };
      },
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: auth.profileLookup }) }) }),
  },
}));

const session = (id: string) => ({ user: { id, email: `${id}@example.com`, user_metadata: {} }, access_token: id });
const profile = (id: string) => ({ id, full_name: id, role: 'qc', is_active: true, permissions: {} });
let root: Root;
let container: HTMLDivElement;

function Probe({ form = 'session' }: { form?: string }) {
  const { user } = useAuth();
  const draft = useFormDraft(form, { metadata: { note: '', cycleId: '' }, answers: {} as Record<string, number> });
  const [transient, setTransient] = useState('');
  return <>
    <output data-user>{user?.id}</output>
    <input aria-label="note" value={draft.values.metadata.note} onChange={(event) => draft.setField('metadata', { ...draft.values.metadata, note: event.target.value })} />
    <input aria-label="transient" value={transient} onChange={(event) => setTransient(event.target.value)} />
    <button onClick={() => draft.setField('answers', { metric: 4 })}>rate</button>
    <button onClick={() => draft.clearDraft()}>complete</button>
    <button onClick={() => draft.clearDraft({ metadata: { note: '', cycleId: '' }, answers: {} })}>discard</button>
    <output data-answer>{draft.values.answers.metric}</output>
    <output data-storage>{String(draft.storageError)}</output>
  </>;
}

function App({ show = true, form }: { show?: boolean; form?: string }) {
  return <RouterProvider><AuthProvider><ProtectedRoute requiredPermission="create_evaluation">
    {show ? <Probe key={form} form={form} /> : <div>Other page</div>}
  </ProtectedRoute></AuthProvider></RouterProvider>;
}

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)); });
}

async function mount() {
  await act(async () => root.render(<App />));
  await settle();
}

async function type(label: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(text: string) {
  await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === text)!.click());
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  localStorage.clear();
  window.history.replaceState(null, '', '/evaluations/new');
  auth.getSession.mockReset().mockResolvedValue({ data: { session: session('alice') }, error: null });
  auth.profileLookup.mockReset().mockResolvedValue({ data: profile('alice'), error: null });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('evaluation persistence', () => {
  it('preserves the mounted page through refocus sign-in and token refresh', async () => {
    await mount();
    await type('note', 'Observation evidence');
    await type('transient', 'Must not remount');
    let resolveLookup!: (value: unknown) => void;
    auth.profileLookup.mockReturnValue(new Promise((resolve) => { resolveLookup = resolve; }));
    for (const event of ['SIGNED_IN', 'TOKEN_REFRESHED']) {
      await act(async () => auth.listener!(event, session('alice')));
      await settle();
      expect(container.querySelector<HTMLInputElement>('[aria-label="transient"]')?.value).toBe('Must not remount');
    }
    await act(async () => resolveLookup({ data: profile('alice'), error: null }));
    expect(container.querySelector<HTMLInputElement>('[aria-label="note"]')?.value).toBe('Observation evidence');
  });

  it('restores notes and ratings after route navigation and a full remount', async () => {
    await mount();
    await type('note', 'Keep this feedback');
    await click('rate');
    await act(async () => root.render(<App show={false} />));
    await act(async () => root.render(<App />));
    expect(container.querySelector<HTMLInputElement>('[aria-label="note"]')?.value).toBe('Keep this feedback');
    expect(container.querySelector('[data-answer]')?.textContent).toBe('4');
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    expect(container.querySelector<HTMLInputElement>('[aria-label="note"]')?.value).toBe('Keep this feedback');
    expect(container.querySelector('[data-answer]')?.textContent).toBe('4');
  });

  it('keeps session and final-project drafts separate', async () => {
    await mount();
    await type('note', 'Session feedback');
    await act(async () => root.render(<App form="final-project" />));
    expect(container.querySelector<HTMLInputElement>('[aria-label="note"]')?.value).toBe('');
    await type('note', 'Project feedback');
    await act(async () => root.render(<App form="session" />));
    expect(container.querySelector<HTMLInputElement>('[aria-label="note"]')?.value).toBe('Session feedback');
  });

  it('clears saved input only on completion or explicit discard', async () => {
    await mount();
    await type('note', 'Draft to complete');
    await click('complete');
    expect(localStorage.getItem('b2b-offline-draft:v1:alice:session')).toBeNull();
    await act(async () => root.render(<App show={false} />));
    await act(async () => root.render(<App />));
    expect(container.querySelector<HTMLInputElement>('[aria-label="note"]')?.value).toBe('');
    await type('note', 'Draft to discard');
    await click('discard');
    expect(container.querySelector<HTMLInputElement>('[aria-label="note"]')?.value).toBe('');
    expect(localStorage.getItem('b2b-offline-draft:v1:alice:session')).toBeNull();
  });

  it('never restores a previous user profile or draft after an account switch', async () => {
    await mount();
    await type('note', 'Private Alice feedback');
    let resolveOld!: (value: unknown) => void;
    auth.profileLookup.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    await act(async () => auth.listener!('TOKEN_REFRESHED', session('alice')));
    await settle();
    auth.profileLookup.mockResolvedValue({ data: profile('bob'), error: null });
    await act(async () => auth.listener!('SIGNED_IN', session('bob')));
    await settle();
    await act(async () => resolveOld({ data: profile('alice'), error: null }));
    expect(container.querySelector('[data-user]')?.textContent).toBe('bob');
    expect(container.querySelector<HTMLInputElement>('[aria-label="note"]')?.value).toBe('');
    expect(localStorage.getItem('b2b-offline-draft:v1:alice:session')).toContain('Private Alice feedback');
    await act(async () => auth.listener!('SIGNED_OUT', null));
    expect(container.querySelector('[aria-label="note"]')).toBeNull();
  });

  it('continues safely when browser storage is full or unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    await mount();
    await type('note', 'Still editable');
    expect(container.querySelector<HTMLInputElement>('[aria-label="note"]')?.value).toBe('Still editable');
    expect(container.querySelector('[data-storage]')?.textContent).toBe('true');
  });

  it('recovers from malformed stored data and preserves newer default fields', async () => {
    localStorage.setItem('b2b-offline-draft:v1:alice:session', '{broken');
    await mount();
    expect(container.querySelector<HTMLInputElement>('[aria-label="note"]')?.value).toBe('');
    await type('note', 'Recovered draft');
    expect(JSON.parse(localStorage.getItem('b2b-offline-draft:v1:alice:session')!).values.metadata.cycleId).toBe('');
  });
});
