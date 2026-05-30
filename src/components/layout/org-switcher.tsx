'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, Check, Building2, Loader2 } from 'lucide-react';

interface OrgRow {
  id: string;
  name: string;
  slug: string | null;
  role: 'owner' | 'admin' | 'member';
  is_active: boolean;
}

export default function OrgSwitcher() {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const res = await fetch('/api/org/list');
      if (!res.ok) return;
      const json = (await res.json()) as { organisations: OrgRow[] };
      setOrgs(json.organisations);
    } finally {
      setLoading(false);
    }
  }

  async function handleSwitch(orgId: string) {
    setSwitching(orgId);
    try {
      const res = await fetch('/api/org/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organisation_id: orgId }),
      });
      const json = await res.json();
      if (res.ok && json.redirect) {
        window.location.href = json.redirect;
      }
    } finally {
      setSwitching(null);
    }
  }

  const active = orgs.find((o) => o.is_active);
  
  // Debug: show active org ID
  const debugOrgId = active?.id?.slice(0, 8) ?? 'none';

  if (loading) {
    return (
      <div className="mt-3 px-3 py-2 bg-dark-800 rounded text-xs text-dark-500 flex items-center gap-2">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading orgs…
      </div>
    );
  }

  if (orgs.length === 0) return null;

  // Always show dropdown if user has multiple orgs
  if (orgs.length <= 1) {
    return (
      <div className="mt-3 px-3 py-2 bg-dark-800 rounded text-xs text-dark-300 flex items-center gap-2">
        <Building2 className="w-3.5 h-3.5 text-corp-green-400" />
        <span className="truncate">{active?.name ?? orgs[0].name}</span>
        <span className="text-dark-500 ml-auto" title={active?.id}>@{debugOrgId}</span>
      </div>
    );
  }

  return (
    <div className="relative mt-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 bg-dark-800 hover:bg-dark-700 rounded text-xs flex items-center gap-2 text-left"
      >
        <Building2 className="w-3.5 h-3.5 text-corp-green-400 flex-shrink-0" />
        <span className="flex-1 truncate text-dark-200">{active?.name ?? 'Choose an org'}</span>
        <ChevronDown className={`w-3 h-3 text-dark-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40"
            aria-hidden="true"
          />
          <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-dark-800 border border-dark-700 rounded shadow-lg overflow-hidden">
            {orgs.map((o) => (
              <button
                key={o.id}
                onClick={() => handleSwitch(o.id)}
                disabled={switching !== null}
                className="w-full px-3 py-2 hover:bg-dark-700 text-left text-xs flex items-center gap-2 disabled:opacity-50"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-dark-200 truncate flex items-center gap-2">
                    {o.name}
                    {o.is_active && <Check className="w-3 h-3 text-corp-green-400" />}
                  </div>
                  <div className="text-dark-500 uppercase tracking-wide text-[10px]">{o.role}</div>
                </div>
                {switching === o.id && <Loader2 className="w-3 h-3 animate-spin text-dark-500" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
