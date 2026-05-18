'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import {
  LayoutDashboard, Users, Package, MessageSquare, Search,
  Settings, LogOut, Zap, Send, Inbox, Workflow, Plug, Briefcase,
  Menu, X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { ElevenLabsWidget } from '@/components/layout/elevenlabs-widget';
import OrgSwitcher from '@/components/layout/org-switcher';

// Suffixes (not absolute paths) so we can prefix /org/<slug> at render time.
// Ordered by operator journey: Dashboard → Set up → Find & approve → Track → Reference.
const navGroups: Array<{ label: string | null; items: Array<{ suffix: string; label: string; icon: typeof LayoutDashboard }> }> = [
  {
    label: null,
    items: [
      { suffix: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Set up',
    items: [
      { suffix: '/settings', label: 'Settings', icon: Settings },
      { suffix: '/products', label: 'Products (Sales)', icon: Package },
      { suffix: '/projects', label: 'Projects (Funding)', icon: Briefcase },
      { suffix: '/channels', label: 'Channels', icon: Plug },
    ],
  },
  {
    label: 'Find & approve',
    items: [
      { suffix: '/discover', label: 'Discover', icon: Search },
      { suffix: '/partners', label: 'Prospects', icon: Users },
      { suffix: '/approvals', label: 'Approvals', icon: Inbox },
    ],
  },
  {
    label: 'Track',
    items: [
      { suffix: '/outreach', label: 'Outreach', icon: Send },
      { suffix: '/sessions', label: 'Sessions', icon: MessageSquare },
    ],
  },
  {
    label: 'Reference',
    items: [
      { suffix: '/sequences', label: 'Sequences', icon: Workflow },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const params = useParams<{ slug?: string }>();
  const slug = params?.slug;
  const orgPrefix = slug ? `/org/${slug}` : '';
  const homeHref = slug ? `/org/${slug}/dashboard` : '/dashboard';
  const supabase = createClient();
  const [open, setOpen] = useState(false);

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  return (
    <>
      {/* Mobile-only top bar — hamburger + brand. Sticky so it stays visible
          while the user scrolls a long page. Hidden on lg+. */}
      <div className="lg:hidden sticky top-0 z-30 bg-dark-900 border-b border-dark-700 px-4 py-3 flex items-center justify-between">
        <Link href={homeHref} className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-corp-green-500" />
          <span className="text-lg font-bold">InvestorPilot</span>
        </Link>
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="p-2 -mr-2 text-dark-200 hover:text-white"
        >
          <Menu className="w-6 h-6" />
        </button>
      </div>

      {/* Backdrop — only rendered while drawer is open on mobile. */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="lg:hidden fixed inset-0 bg-black/60 z-40"
          aria-hidden="true"
        />
      )}

      {/* Sidebar drawer. Fixed on all sizes; on mobile it slides in from
          the left, on lg+ it stays visible at left. Main content uses
          lg:ml-64 to leave space for it on desktop. */}
      <aside
        className={`
          fixed top-0 left-0 z-50
          w-64 h-screen bg-dark-900 border-r border-dark-700 flex flex-col
          transition-transform duration-200 ease-out
          ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        <div className="p-6 border-b border-dark-700 flex items-start justify-between">
          <div>
            <Link href={homeHref} onClick={() => setOpen(false)} className="flex items-center gap-2">
              <Zap className="w-6 h-6 text-corp-green-500" />
              <span className="text-xl font-bold">InvestorPilot</span>
            </Link>
            <p className="text-dark-500 text-xs mt-1">by Corporate AI Solutions</p>
            <OrgSwitcher />
          </div>
          <button
            onClick={() => setOpen(false)}
            className="lg:hidden p-1 -mr-1 text-dark-400 hover:text-white"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-4 overflow-y-auto">
          {navGroups.map((group, gi) => (
            <div key={gi} className="space-y-1">
              {group.label && (
                <p className="text-dark-600 text-[10px] uppercase tracking-wider font-medium px-3 pb-1">
                  {group.label}
                </p>
              )}
              {group.items.map((item) => {
                const href = `${orgPrefix}${item.suffix}`;
                const isActive = pathname === href || pathname.startsWith(href + '/');
                return (
                  <Link
                    key={item.suffix}
                    href={href}
                    onClick={() => setOpen(false)}
                    className={isActive ? 'nav-link-active flex items-center gap-3' : 'nav-link flex items-center gap-3'}
                  >
                    <item.icon className="w-5 h-5" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* ElevenLabs voice-help widget sits between the nav (which ends at
            Reference / Sequences) and the Sign out block — fills the
            natural gap created by the nav's flex-1. The widget is a Web
            Component that self-positions via fixed CSS by default; the
            .sidebar-elevenlabs wrapper + global override in globals.css
            forces it to flow inline and fit the sidebar width. */}
        <div className="sidebar-elevenlabs p-3 border-t border-dark-700">
          <ElevenLabsWidget />
        </div>

        <div className="p-4 border-t border-dark-700">
          <button
            onClick={handleLogout}
            className="nav-link flex items-center gap-3 w-full text-left"
          >
            <LogOut className="w-5 h-5" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
