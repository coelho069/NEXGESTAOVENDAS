import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { useAuthMock, usePathnameMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  usePathnameMock: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}));

vi.mock('next/dynamic', () => ({
  default: () =>
    function MockHermesWidget() {
      return <div data-testid="hermes-widget">Hermes</div>;
    },
}));

import { HermesChatWidgetLazyMount } from '@/components/hermes/chat-widget-client';

describe('HermesChatWidgetLazyMount visibility', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('does not render when the visitor is logged out', () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    usePathnameMock.mockReturnValue('/pdv');

    render(<HermesChatWidgetLazyMount />);

    expect(screen.queryByTestId('hermes-widget')).not.toBeInTheDocument();
  });

  it('does not render on public landing even when authenticated', () => {
    useAuthMock.mockReturnValue({ user: { id: 'user-1' }, loading: false });
    usePathnameMock.mockReturnValue('/');

    render(<HermesChatWidgetLazyMount />);

    expect(screen.queryByTestId('hermes-widget')).not.toBeInTheDocument();
  });

  it('does not render on protected routes when the assistant is not configured', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'user-1' }, loading: false });
    usePathnameMock.mockReturnValue('/pdv');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ configured: false }),
      }),
    );

    render(<HermesChatWidgetLazyMount />);

    await waitFor(() => {
      expect(screen.queryByTestId('hermes-widget')).not.toBeInTheDocument();
    });
  });

  it('renders on protected routes when authenticated and configured', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'user-1' }, loading: false });
    usePathnameMock.mockReturnValue('/pdv');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ configured: true }),
      }),
    );

    render(<HermesChatWidgetLazyMount />);

    expect(await screen.findByTestId('hermes-widget')).toBeInTheDocument();
  });
});
