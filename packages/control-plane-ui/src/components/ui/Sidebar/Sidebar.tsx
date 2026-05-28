import { useState, useRef, useEffect, useCallback } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/auth/context/AuthContext';
import { useTheme } from '@/theme/useTheme';
import { SUPPORTED_LANGUAGES, LANGUAGE_STORAGE_KEY } from '@/i18n';
import { alertsApi } from '@/api/services/alerts/alerts';
import { buildSidebarNavSections } from '@/routes/shellRouteConfig';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../DropdownMenu';
import { MenuIcon, NavIconForPath } from './Sidebar.icons';
import styles from './Sidebar.module.css';

/* ── Data model (aligned with shellRouteConfig nav metadata) ───────────────── */

interface NavItem {
  /** i18n key resolved via t('nav:...') at render time */
  labelKey: string;
  path: string;
  allowedActions?: string[];
  /** Regex sources whose match against the URL keeps this item active. */
  relatedPaths?: string[];
}

interface NavSection {
  /** i18n key resolved via t('nav:...') at render time */
  titleKey: string;
  collapsible: boolean;
  defaultOpen?: boolean;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = buildSidebarNavSections();
const ALL_ITEM_PATHS = NAV_SECTIONS.flatMap((s) => s.items.map((item) => item.path));

const STORAGE_KEY = 'nexus_sidebar_collapsed';
const ALERT_POLL_INTERVAL_MS = 60_000;

const THEME_PACK_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'morningstar', label: 'Morningstar' },
  { value: 'rbc', label: 'RBC Royal Bank' },
] as const;

const MODE_OPTIONS = [
  { value: 'light' as const, labelKey: 'themeLight', icon: 'sun' },
  { value: 'dark' as const, labelKey: 'themeDark', icon: 'moon' },
  { value: 'system' as const, labelKey: 'themeSystem', icon: 'monitor' },
];

type UserMenuSection = 'theme' | 'skin' | 'language';

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function itemMatchesRoute(pathname: string, item: NavItem): boolean {
  const itemPath = item.path;
  if (itemPath === '/') {
    return pathname === '/' || pathname === '';
  }
  if (pathname === itemPath) return true;
  if (pathname.startsWith(`${itemPath}/`)) {
    // Prefix match only when no more-specific nav item also covers this path.
    // Prevents /analytics from staying active when /analytics/cache-roi is current.
    const moreSpecific = ALL_ITEM_PATHS.some(
      (p) =>
        p !== itemPath &&
        p.startsWith(`${itemPath}/`) &&
        (pathname === p || pathname.startsWith(`${p}/`)),
    );
    if (!moreSpecific) return true;
  }
  // Drill-down pages may live outside the item's URL tree (e.g.
  // proxy-rollout → /infrastructure/nodes/:id/setup). relatedPaths keeps
  // those drilldowns highlighted on the landing entry.
  if (item.relatedPaths && item.relatedPaths.length > 0) {
    for (const src of item.relatedPaths) {
      try {
        if (new RegExp(src).test(pathname)) return true;
      } catch {
        // Bad regex in config — ignore so the sidebar still renders.
      }
    }
  }
  return false;
}

/* ── Collapsible list (animated max-height) ───────────────────────────────── */

function CollapsibleList({ open, children }: { open: boolean; children: React.ReactNode }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<string>(open ? 'none' : '0px');

  useEffect(() => {
    if (open) {
      const h = innerRef.current?.scrollHeight ?? 0;
      setMaxHeight(`${h}px`);
      const timer = setTimeout(() => setMaxHeight('none'), 220);
      return () => clearTimeout(timer);
    }
    if (innerRef.current) {
      setMaxHeight(`${innerRef.current.scrollHeight}px`);

      innerRef.current.offsetHeight;
    }
    requestAnimationFrame(() => setMaxHeight('0px'));
  }, [open]);

  return (
    <div
      ref={innerRef}
      className={clsx(styles.collapsibleWrapper, maxHeight === 'none' && styles.collapsibleNone)}
      style={{ maxHeight }}
    >
      {children}
    </div>
  );
}

/* ── Single nav link ──────────────────────────────────────────────────────── */

function SidebarNavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const isActive = itemMatchesRoute(pathname, item);
  return (
    <NavLink
      to={item.path}
      onClick={onNavigate}
      className={clsx(styles.navLink, isActive && styles.navLinkActive)}
    >
      <NavIconForPath path={item.path} />
      <span className={styles.navLinkLabel}>{t(`nav:${item.labelKey}`)}</span>
    </NavLink>
  );
}

/* ── Sidebar props ────────────────────────────────────────────────────────── */

export interface SidebarProps {
  /** When true the sidebar is visually collapsed (width 0). Managed by the Shell. */
  collapsed?: boolean;
  /** Called when the sidebar requests a toggle (e.g. internal hamburger in a future iteration). */
  onToggle?: () => void;
  /** Called after a nav link is clicked (useful for closing mobile drawer). */
  onNavigate?: () => void;
}

/* ── Sidebar component ────────────────────────────────────────────────────── */

export function Sidebar({ collapsed = false, onToggle, onNavigate }: SidebarProps) {
  const { permissions } = useAuth();
  const { brand } = useTheme();
  const { t } = useTranslation();
  const location = useLocation();

  /* Section collapse state (persisted per-section, independent of sidebar collapsed prop) */
  const [sectionCollapsed, setSectionCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    } catch {
      return {};
    }
  });

  const toggleSection = (titleKey: string) => {
    const next = { ...sectionCollapsed, [titleKey]: !sectionCollapsed[titleKey] };
    setSectionCollapsed(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const isSectionOpen = (section: NavSection, visibleItems: NavItem[]): boolean => {
    if (!section.collapsible) return true;
    if (sectionCollapsed[section.titleKey] !== undefined) return !sectionCollapsed[section.titleKey];
    const hasActive = visibleItems.some((it) => itemMatchesRoute(location.pathname, it));
    if (hasActive) return true;
    return section.defaultOpen !== false;
  };

  const brandInitial = brand.productName.charAt(0).toUpperCase();
  const sidebarToggleLabel = t(collapsed ? 'nav:expandSidebar' : 'nav:collapseSidebar');
  const logoLockup = brand.logoMark && brand.logoFull && brand.logoTagline
    ? { mark: brand.logoMark, wordmark: brand.logoFull, tagline: brand.logoTagline }
    : null;

  return (
    <nav
      aria-label={t('common:mainNavigation')}
      className={clsx(
        styles.sidebar,
        collapsed && styles.collapsed,
        'anim-sidebar border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
      )}
    >
      {/* Brand header */}
      <header className={clsx(styles.header, logoLockup && styles.logoLockupHeader)}>
        <div className={clsx(styles.brandRow, logoLockup && styles.logoLockupRow)}>
          {logoLockup ? (
            <>
              <div className={clsx(styles.brandMark, styles.logoLockupMark)} aria-hidden>
                <img src={logoLockup.mark} alt="" />
              </div>
              <div className={clsx(styles.brandText, styles.logoLockupText)}>
                <img
                  src={logoLockup.wordmark}
                  alt={brand.productName}
                  className={styles.logoLockupWordmark}
                />
                <img
                  src={logoLockup.tagline}
                  alt=""
                  className={styles.logoLockupTagline}
                  aria-hidden="true"
                />
              </div>
            </>
          ) : (
            <>
              <div className={styles.brandMark} aria-hidden>
                {brand.logoMark ? (
                  <img src={brand.logoMark} alt="" />
                ) : (
                  brandInitial
                )}
              </div>
              <div className={styles.brandText}>
                <div className={styles.brandName}>{brand.productName}</div>
                <div className={styles.brandSubtitle}>{t('nav:adminConsole')}</div>
              </div>
            </>
          )}
        </div>
      </header>
      {onToggle && (
        <button data-design-system-escape="primitive-internal"
          type="button"
          className={styles.collapseToggle}
          onClick={onToggle}
          aria-label={sidebarToggleLabel}
          title={sidebarToggleLabel}
        >
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
            className={clsx(styles.collapseIcon, collapsed && styles.collapseIconFlipped)}
            aria-hidden="true"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}

      <div className={styles.divider} />

      {/* Navigation sections */}
      <div className={styles.body}>
        {NAV_SECTIONS.map((section, sectionIndex) => {
          const visibleItems = section.items.filter((item) => {
            if (!item.allowedActions) return true;
            return permissions.length > 0 && item.allowedActions.some(a => permissions.includes(a));
          });
          if (visibleItems.length === 0) return null;

          const open = isSectionOpen(section, visibleItems);

          return (
            <div key={section.titleKey} className={styles.section}>
              {section.collapsible ? (
                <button data-design-system-escape="primitive-internal"
                  type="button"
                  className={styles.sectionToggle}
                  onClick={() => toggleSection(section.titleKey)}
                  aria-expanded={open}
                >
                  <span>{t(`nav:${section.titleKey}`)}</span>
                  <svg
                    className={clsx(styles.chevron, open && styles.chevronOpen)}
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              ) : (
                <div
                  className={clsx(
                    styles.sectionLabel,
                    sectionIndex === 0 && styles.sectionLabelFirst,
                  )}
                >
                  {t(`nav:${section.titleKey}`)}
                </div>
              )}

              <CollapsibleList open={open}>
                <ul className={styles.navList}>
                  {visibleItems.map((item) => (
                    <li key={item.path}>
                      <SidebarNavLink item={item} onNavigate={onNavigate} />
                    </li>
                  ))}
                </ul>
              </CollapsibleList>
            </div>
          );
        })}
      </div>

      <SidebarUserBlock collapsed={collapsed} />
    </nav>
  );
}

function SidebarAlertMenuItem() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    try {
      const res = await alertsApi.list({ state: ['firing'], limit: 1 });
      setCount(res.total ?? 0);
    } catch {
      setCount(0);
    }
  }, []);

  useEffect(() => {
    void fetchCount();
    const timer = setInterval(() => void fetchCount(), ALERT_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchCount]);

  return (
    <DropdownMenuItem className={styles.userMenuItem} onSelect={() => navigate('/alerts')}>
      <MenuIcon name="bell" />
      <span className={styles.menuItemLabel}>{t('common:notifications')}</span>
      {count > 0 && (
        <span className={styles.menuBadge}>{count > 99 ? '99+' : count}</span>
      )}
    </DropdownMenuItem>
  );
}

function SidebarUserBlock({ collapsed }: { collapsed: boolean }) {
  const { keyName, email, logout } = useAuth();
  const { mode, setMode, themeId, setThemeId } = useTheme();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [openSection, setOpenSection] = useState<UserMenuSection | null>(null);

  const displayName = email || keyName || t('common:userMenu');
  const initial = displayName.trim().charAt(0).toUpperCase() || '?';
  const currentLang = i18n.language.split('-')[0];
  const currentModeLabel = t(`common:${MODE_OPTIONS.find((opt) => opt.value === mode)?.labelKey ?? 'themeSystem'}`);
  const currentThemeLabel = THEME_PACK_OPTIONS.find((opt) => opt.value === themeId)?.label ?? THEME_PACK_OPTIONS[0].label;
  const currentLanguageLabel = SUPPORTED_LANGUAGES.find((lang) => lang.code === currentLang)?.label ?? SUPPORTED_LANGUAGES[0].label;

  const changeLanguage = (code: string) => {
    void i18n.changeLanguage(code);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  };

  const toggleMenuSection = (section: UserMenuSection) => {
    setOpenSection((current) => current === section ? null : section);
  };

  return (
    <footer className={styles.footer}>
      <DropdownMenu onOpenChange={(open) => {
        if (!open) setOpenSection(null);
      }}>
        <DropdownMenuTrigger asChild>
          <button
            data-design-system-escape="primitive-internal"
            type="button"
            className={styles.userBlockTrigger}
            aria-label={t('common:userMenu')}
          >
            <span className={styles.userAvatar}>
              {initial}
              <span className={styles.userStatusDot} />
            </span>
            {!collapsed && (
              <>
                <span className={styles.userNameBlock}>
                  <span className={styles.userNameMain}>{displayName}</span>
                  <span className={styles.userNameSub}>{t('nav:adminConsole')}</span>
                </span>
                <svg
                  className={styles.userChevron}
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className={styles.userMenuContent}
          side={collapsed ? 'right' : 'top'}
          align={collapsed ? 'end' : 'start'}
          sideOffset={collapsed ? 8 : 6}
        >
          <SidebarAlertMenuItem />
          <DropdownMenuSeparator className={styles.userMenuSeparator} />

          <div className={clsx(styles.menuAccordionSection, openSection === 'theme' && styles.menuAccordionSectionOpen)}>
            <button
              data-design-system-escape="primitive-internal"
              type="button"
              className={styles.menuSectionTrigger}
              aria-expanded={openSection === 'theme'}
              onClick={() => toggleMenuSection('theme')}
            >
              <MenuIcon name="monitor" />
              <span className={styles.menuItemLabel}>{t('common:theme')}</span>
              <span className={styles.menuSectionValue}>{currentModeLabel}</span>
              <svg className={styles.menuSectionChevron} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {openSection === 'theme' && (
              <div className={styles.menuSubmenu}>
                {MODE_OPTIONS.map((opt) => (
                  <button
                    data-design-system-escape="primitive-internal"
                    key={opt.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={mode === opt.value}
                    className={clsx(styles.menuOptionItem, mode === opt.value && styles.userMenuItemActive)}
                    onClick={() => setMode(opt.value)}
                  >
                    <MenuIcon name={opt.icon} />
                    <span className={styles.menuItemLabel}>{t(`common:${opt.labelKey}`)}</span>
                    {mode === opt.value && <span className={styles.menuCheck}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={clsx(styles.menuAccordionSection, openSection === 'skin' && styles.menuAccordionSectionOpen)}>
            <button
              data-design-system-escape="primitive-internal"
              type="button"
              className={styles.menuSectionTrigger}
              aria-expanded={openSection === 'skin'}
              onClick={() => toggleMenuSection('skin')}
            >
              <MenuIcon name="palette" />
              <span className={styles.menuItemLabel}>{t('common:skin')}</span>
              <span className={styles.menuSectionValue}>{currentThemeLabel}</span>
              <svg className={styles.menuSectionChevron} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {openSection === 'skin' && (
              <div className={styles.menuSubmenu}>
                {THEME_PACK_OPTIONS.map((opt) => (
                  <button
                    data-design-system-escape="primitive-internal"
                    key={opt.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={themeId === opt.value}
                    className={clsx(styles.menuOptionItem, themeId === opt.value && styles.userMenuItemActive)}
                    onClick={() => setThemeId(opt.value)}
                  >
                    <MenuIcon name="palette" />
                    <span className={styles.menuItemLabel}>{opt.label}</span>
                    {themeId === opt.value && <span className={styles.menuCheck}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={clsx(styles.menuAccordionSection, openSection === 'language' && styles.menuAccordionSectionOpen)}>
            <button
              data-design-system-escape="primitive-internal"
              type="button"
              className={styles.menuSectionTrigger}
              aria-expanded={openSection === 'language'}
              onClick={() => toggleMenuSection('language')}
            >
              <MenuIcon name="globe" />
              <span className={styles.menuItemLabel}>{t('common:language')}</span>
              <span className={styles.menuSectionValue}>{currentLanguageLabel}</span>
              <svg className={styles.menuSectionChevron} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {openSection === 'language' && (
              <div className={styles.menuSubmenu}>
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <button
                    data-design-system-escape="primitive-internal"
                    key={lang.code}
                    type="button"
                    role="menuitemradio"
                    aria-checked={currentLang === lang.code}
                    className={clsx(styles.menuOptionItem, currentLang === lang.code && styles.userMenuItemActive)}
                    onClick={() => changeLanguage(lang.code)}
                  >
                    <MenuIcon name="globe" />
                    <span className={styles.menuItemLabel}>
                      {lang.flag} {lang.label}
                    </span>
                    {currentLang === lang.code && <span className={styles.menuCheck}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <DropdownMenuSeparator className={styles.userMenuSeparator} />
          <DropdownMenuItem className={styles.userMenuItem} onSelect={() => navigate('/account')}>
            <MenuIcon name="user" />
            <span className={styles.menuItemLabel}>{t('common:myAccount')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem className={clsx(styles.userMenuItem, styles.logoutItem)} onSelect={logout}>
            <MenuIcon name="logout" />
            <span className={styles.menuItemLabel}>{t('common:signOut')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </footer>
  );
}
