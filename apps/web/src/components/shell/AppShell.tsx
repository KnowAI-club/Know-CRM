'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, Menu as MenuIcon, Moon, Sun, X } from 'lucide-react';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/cn';
import { Avatar, Spinner } from '@/components/ui';
import { BRAND } from '@/lib/brand';
import { NAV } from './nav';
import { BrandMark } from './BrandMark';
import { GlobalSearch } from './GlobalSearch';
import { NotificationBell } from './NotificationBell';

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setDark(t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
  }, []);
  const toggle = () => {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('crm-theme', next);
    } catch {}
    setDark(!dark);
  };
  return (
    <button
      onClick={toggle}
      className="grid h-9 w-9 place-items-center rounded-lg text-mute hover:bg-subtle hover:text-ink"
      aria-label="Toggle dark mode"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

/** Signed-in team layout: sidebar navigation, search, notifications. */
export function AppShell({ children }: { children: ReactNode }) {
  const { status, user, workspace, isAdmin, logout } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!status) return;
    if (!status.user) router.replace('/login');
    else if (status.user.role === 'client') router.replace('/portal');
  }, [status, router]);
  useEffect(() => setMobileOpen(false), [pathname]);

  if (!status || !user || user.role === 'client') return <Spinner />;
  const active = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));

  const sidebar = (
    <nav className="flex h-full flex-col">
      <Link href="/" className="flex items-center gap-2.5 px-4 py-4">
        <BrandMark />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{BRAND}</span>
          {workspace?.name && <span className="block truncate text-xs text-mute">{workspace.name}</span>}
        </span>
      </Link>
      <div className="flex-1 space-y-4 overflow-y-auto px-2 pb-4">
        {NAV.map((section) => (
          <div key={section.section}>
            <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wider text-faint uppercase">{section.section}</p>
            {section.items
              .filter((i) => !i.adminOnly || isAdmin)
              .map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition',
                    active(item.href) ? 'bg-acc-soft font-medium text-acc' : 'text-mute hover:bg-subtle hover:text-ink',
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-3 py-3">
        <Avatar name={user.name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-mute capitalize">{user.role}</p>
        </div>
        <button
          onClick={logout}
          className="rounded-md p-1.5 text-mute hover:bg-subtle hover:text-ink"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:pl-60">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-line bg-card lg:block">{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-line bg-card shadow-xl">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-3 rounded-md p-1 text-mute"
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-bg/90 px-4 backdrop-blur sm:px-6">
        <button onClick={() => setMobileOpen(true)} className="rounded-md p-1.5 text-mute hover:bg-subtle lg:hidden" aria-label="Open menu">
          <MenuIcon className="h-5 w-5" />
        </button>
        <div className="flex flex-1 justify-center lg:justify-start">
          <GlobalSearch isAdmin={isAdmin} />
        </div>
        <ThemeToggle />
        <NotificationBell />
      </header>
      <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </div>
  );
}
