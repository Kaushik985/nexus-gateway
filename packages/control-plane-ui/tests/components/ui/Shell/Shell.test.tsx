import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { Shell } from '@/components/ui/Shell/Shell';

// Isolate Shell's layout/viewport logic — stub the heavy children.
vi.mock('@/components/ui/Sidebar', () => ({ Sidebar: () => <nav data-testid="sidebar">nav</nav> }));
vi.mock('@/components/ui/Header', () => ({ Header: ({ onMenuToggle }: { onMenuToggle?: () => void }) => <button onClick={onMenuToggle}>menu</button> }));
vi.mock('@/components/SetupBanner', () => ({ SetupBanner: () => <div data-testid="setup-banner" /> }));

function renderShell() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/x']}>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/x" element={<div>outlet-content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('Shell', () => {
  beforeEach(() => { window.innerWidth = 1280; });

  it('renders sidebar + outlet content on desktop (no mobile header)', () => {
    renderShell();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByText('outlet-content')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'menu' })).toBeNull(); // mobile-only header
  });

  it('shows the mobile header + toggles the menu under the mobile breakpoint', () => {
    window.innerWidth = 500;
    renderShell();
    const menuBtn = screen.getByRole('button', { name: 'menu' });
    expect(menuBtn).toBeInTheDocument();
    fireEvent.click(menuBtn); // opens overlay (no throw)
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });

  it('recomputes the viewport on window resize', () => {
    renderShell();
    expect(screen.queryByRole('button', { name: 'menu' })).toBeNull();
    act(() => { window.innerWidth = 500; window.dispatchEvent(new Event('resize')); });
    expect(screen.getByRole('button', { name: 'menu' })).toBeInTheDocument();
  });
});
