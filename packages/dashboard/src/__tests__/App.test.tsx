import { describe, it, expect, vi } from 'vitest';

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  BrowserRouter: ({ children }: { children: React.ReactNode }) => children,
  Routes: ({ children }: { children: React.ReactNode }) => children,
  Route: () => null,
  NavLink: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useParams: () => ({}),
}));

describe('Dashboard', () => {
  it('should export App component', async () => {
    const module = await import('../App');
    expect(module.default).toBeDefined();
  });

  it('should have API hooks', async () => {
    const module = await import('../hooks/useApi');
    expect(module.useApi).toBeDefined();
    expect(module.apiGet).toBeDefined();
    expect(module.apiPost).toBeDefined();
  });

  it('should have WebSocket hook', async () => {
    const module = await import('../hooks/useWebSocket');
    expect(module.useWebSocket).toBeDefined();
  });
});
