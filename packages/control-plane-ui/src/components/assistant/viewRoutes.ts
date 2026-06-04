// viewToRoute maps an agent canvas "view" (the CLI cockpit vocabulary the kernel
// emits) to a Control Plane UI route. The agent's navigation directives are
// re-expressed here for the web. An unknown view returns null so the widget does
// NOT navigate (graceful — never routes to a broken path). Optional traffic
// filter (status/model) rides as query params the target page can read.

const VIEW_ROUTES: Record<string, string> = {
  overview: '/',
  radar: '/traffic',
  cost: '/analytics',
  slo: '/analytics',
  nodes: '/infrastructure/nodes',
  alerts: '/alerts',
  compliance: '/compliance/overview',
  jobs: '/infrastructure/jobs',
  sync: '/infrastructure/config-sync',
  models: '/ai-gateway/providers',
  keys: '/ai-gateway/virtual-keys',
  rules: '/ai-gateway/routing',
  kill: '/infrastructure/kill-switch',
};

export interface NavOpts {
  status?: string;
  model?: string;
  eventId?: string;
}

export function viewToRoute(view: string, opts: NavOpts = {}): string | null {
  // A single traffic event drills into the Traffic page (it reads ?eventId).
  if (view === 'event') {
    return opts.eventId ? `/traffic?eventId=${encodeURIComponent(opts.eventId)}` : '/traffic';
  }
  const base = VIEW_ROUTES[view];
  if (!base) return null; // unknown view → do not navigate

  const q = new URLSearchParams();
  if (opts.status) q.set('status', opts.status);
  if (opts.model) q.set('model', opts.model);
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

// KNOWN_VIEWS is exported so a test can assert the map stays complete as the agent
// gains views.
export const KNOWN_VIEWS = Object.keys(VIEW_ROUTES).concat('event');
