import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { renderWithRouter } from '@/test/test-utils';
import { TrafficTab } from './TrafficTab';
import { systemApi } from '@/api/services';
import type { TrafficEvent } from '@/api/types';

// Component test for the web-assistant navigation consumer effect (#17 C1).
// Focus = the EFFECT wiring (the risk the spec flagged): a searchParams-reactive
// effect that fetches+opens the event drawer for ?eventId, applies ?status/?model
// filters, and then STRIPS the consumed params from the URL exactly once (no
// loop). The param→patch mapping itself is pinned by the pure-helper unit test
// (liveTrafficFilters.navparams.test.ts).
//
// The real drawer fetches several sidecar endpoints on open; it is stubbed here
// so the test exercises the consumer, not the drawer's data layer.
vi.mock('../audit-drawer/trafficAuditDrawer', () => ({
  DRAWER_MS: 0,
  TrafficEventDrawer: ({ selectedEntry }: { selectedEntry: { id: string } }) => (
    <div data-testid="stub-drawer">{selectedEntry.id}</div>
  ),
}));

// Surfaces the live URL search string so the test can assert param stripping.
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc-search">{loc.search}</div>;
}

// Drives a second navigation within the SAME router (the assistant re-navigating
// while its popup floats over the page) so supersession can be exercised.
function NavToSecond() {
  const [, setSp] = useSearchParams();
  return (
    <button data-testid="go-second" onClick={() => setSp({ eventId: 'second' })}>
      go
    </button>
  );
}

describe('TrafficTab web-assistant navigation consumer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches the event, opens the drawer, and strips ?eventId from the URL', async () => {
    const getEvent = vi
      .spyOn(systemApi, 'getTrafficEvent')
      .mockResolvedValue({ id: 'evt-1' } as TrafficEvent);

    renderWithRouter(
      <>
        <TrafficTab source="" />
        <LocationProbe />
      </>,
      { route: '/traffic?eventId=evt-1' },
    );

    // Drawer opens with the fetched event.
    expect(await screen.findByTestId('stub-drawer')).toHaveTextContent('evt-1');
    expect(getEvent).toHaveBeenCalledWith('evt-1');

    // Param is stripped (consume OR drop) and settles — no re-fetch loop.
    await waitFor(() =>
      expect(screen.getByTestId('loc-search')).not.toHaveTextContent('eventId'),
    );
    expect(getEvent).toHaveBeenCalledTimes(1);
  });

  it('applies a status/model filter nav (chips visible, error→5xx) and strips the params', async () => {
    const getEvent = vi.spyOn(systemApi, 'getTrafficEvent');

    renderWithRouter(
      <>
        <TrafficTab source="" />
        <LocationProbe />
      </>,
      { route: '/traffic?status=error&model=gpt-4o' },
    );

    // The filter is actually APPLIED (not just stripped): the active-filters bar
    // renders deterministic chips from the applied state, proving the error→5xx
    // fold and the model patch landed end-to-end through the component.
    expect(await screen.findByText('Model: gpt-4o')).toBeInTheDocument();
    expect(screen.getByText('HTTP: 5xx server error')).toBeInTheDocument();

    await waitFor(() => {
      const search = screen.getByTestId('loc-search');
      expect(search).not.toHaveTextContent('status');
      expect(search).not.toHaveTextContent('model');
    });
    expect(getEvent).not.toHaveBeenCalled();
  });

  it('leaves the drawer closed when the event fetch fails (gone / not owned)', async () => {
    vi.spyOn(systemApi, 'getTrafficEvent').mockRejectedValue(new Error('404'));

    renderWithRouter(
      <>
        <TrafficTab source="" />
        <LocationProbe />
      </>,
      { route: '/traffic?eventId=missing' },
    );

    // The param is still stripped...
    await waitFor(() =>
      expect(screen.getByTestId('loc-search')).not.toHaveTextContent('eventId'),
    );
    // ...but no drawer opens for a missing event.
    expect(screen.queryByTestId('stub-drawer')).toBeNull();
  });

  it('strips only the consumed nav params, preserving unrelated query params', async () => {
    vi.spyOn(systemApi, 'getTrafficEvent').mockResolvedValue({ id: 'evt-9' } as TrafficEvent);

    // `keep=yes` stands in for any unrelated param the consumer must not touch.
    // (thingId is intentionally NOT used here: the pre-existing tab-reset effect
    // clears the Node filter on mount and the mirror effect then drops thingId
    // from the URL — orthogonal to this consumer, but it would confound the
    // assertion.)
    renderWithRouter(
      <>
        <TrafficTab source="" />
        <LocationProbe />
      </>,
      { route: '/traffic?eventId=evt-9&keep=yes' },
    );

    await waitFor(() => {
      const search = screen.getByTestId('loc-search');
      expect(search).not.toHaveTextContent('eventId');
      expect(search).toHaveTextContent('keep=yes');
    });
  });

  it('opens the drawer exactly once under StrictMode (mount/unmount/remount safe)', async () => {
    // Production wraps the app in <StrictMode>, which double-invokes effects and
    // mount/unmounts once in dev. This pins that the consumer still opens the
    // drawer on the primary path and does not loop or drop the fetch — the
    // rationale for re-arming navMountedRef on setup.
    vi.spyOn(systemApi, 'getTrafficEvent').mockResolvedValue({
      id: 'evt-strict',
    } as TrafficEvent);

    renderWithRouter(
      <StrictMode>
        <TrafficTab source="" />
        <LocationProbe />
      </StrictMode>,
      { route: '/traffic?eventId=evt-strict' },
    );

    expect(await screen.findByTestId('stub-drawer')).toHaveTextContent('evt-strict');
    await waitFor(() =>
      expect(screen.getByTestId('loc-search')).not.toHaveTextContent('eventId'),
    );
  });

  it('lets the latest ?eventId win when an earlier fetch resolves after a newer one', async () => {
    // Supersession guard (navEventReqRef): a slow fetch for an earlier eventId
    // must NOT clobber the drawer once a newer eventId has been navigated to.
    let resolveFirst: (e: TrafficEvent) => void = () => {};
    const firstPending = new Promise<TrafficEvent>((res) => {
      resolveFirst = res;
    });

    const getEvent = vi
      .spyOn(systemApi, 'getTrafficEvent')
      .mockImplementationOnce(() => firstPending) // eventId=first — stays pending
      .mockResolvedValueOnce({ id: 'second' } as TrafficEvent); // eventId=second

    renderWithRouter(
      <>
        <TrafficTab source="" />
        <NavToSecond />
        <LocationProbe />
      </>,
      { route: '/traffic?eventId=first' },
    );

    // First fetch is in flight (pending) and its param already stripped.
    await waitFor(() => expect(getEvent).toHaveBeenCalledWith('first'));

    // Navigate to the second event before the first resolves.
    fireEvent.click(screen.getByTestId('go-second'));
    await waitFor(() => expect(getEvent).toHaveBeenCalledWith('second'));

    // The drawer shows the second (latest) event.
    await waitFor(() =>
      expect(screen.getByTestId('stub-drawer')).toHaveTextContent('second'),
    );

    // Now resolve the superseded first fetch — it must NOT clobber the drawer.
    resolveFirst({ id: 'first' } as TrafficEvent);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('stub-drawer')).toHaveTextContent('second');
    expect(getEvent).toHaveBeenCalledTimes(2);
  });
});
