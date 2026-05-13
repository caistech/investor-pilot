'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Package, MessageSquare, Search,
  Settings, LogOut, Zap, Send, Inbox, Workflow, Plug, Briefcase,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

// Ordered by operator journey: Dashboard → setup (Products, Channels) →
// workflow (Discover → Prospects → Approvals) → reference (Sequences,
// Sessions, Outreach) → Settings.
const navGroups: Array<{ label: string | null; items: Array<{ href: string; label: string; icon: typeof LayoutDashboard }> }> = [
  {
    label: null,
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Setup',
    items: [
      { href: '/projects', label: 'Projects', icon: Briefcase },
      { href: '/channels', label: 'Channels', icon: Plug },
    ],
  },
  {
    label: 'Workflow',
    items: [
      { href: '/discover', label: 'Discover', icon: Search },
      { href: '/partners', label: 'Prospects', icon: Users },
      { href: '/approvals', label: 'Approvals', icon: Inbox },
    ],
  },
  {
    label: 'Reference',
    items: [
      { href: '/sequences', label: 'Sequences', icon: Workflow },
      { href: '/sessions', label: 'Sessions', icon: MessageSquare },
      { href: '/outreach', label: 'Outreach', icon: Send },
    ],
  },
  {
    label: null,
    items: [
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const supabase = createClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  return (
    <aside className="w-64 bg-dark-900 border-r border-dark-700 flex flex-col h-screen sticky top-0">
      <div className="p-6 border-b border-dark-700">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Zap className="w-6 h-6 text-corp-green-500" />
          <span className="text-xl font-bold">InvestorPilot</span>
        </Link>
        <p className="text-dark-500 text-xs mt-1">by Corporate AI Solutions</p>
      </div>

      <nav className="flex-1 p-4 space-y-4">
        {navGroups.map((group, gi) => (
          <div key={gi} className="space-y-1">
            {group.label && (
              <p className="text-dark-600 text-[10px] uppercase tracking-wider font-medium px-3 pb-1">
                {group.label}
              </p>
            )}
            {group.items.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.href}
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
  );
}
