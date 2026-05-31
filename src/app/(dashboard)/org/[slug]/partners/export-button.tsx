'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';

export function ExportButton({ organisationId, count }: { organisationId: string; count: number }) {
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    if (count === 0) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/partners/export?org_id=${organisationId}`);
      const data = await res.json();

      // Surface server errors instead of silently doing nothing. The route
      // 500s if it selects a column that doesn't exist; previously that
      // landed here as `data.partners === undefined`, the guard below fell
      // through, and the button just stopped with no feedback. Now the
      // operator sees why.
      if (!res.ok) {
        console.error('Export failed:', data?.error);
        alert(`Export failed: ${data?.error ?? `HTTP ${res.status}`}`);
        return;
      }

      if (!data.partners || data.partners.length === 0) {
        alert('No prospects to export.');
        return;
      }

      // Columns below are verified against the real partners table.
      // (The prior version read p.name / p.contact_phone / p.email_source,
      // none of which exist — every such cell exported blank.)
      const headers = [
        'Company',
        'Contact',
        'Title',
        'Email',
        'LinkedIn',
        'Domain',
        'Source',
        'Type',
        'Network',
        'Score',
        'Status',
        'Email Status',
        'Contact Source',
        'Created',
      ];
      const rows = data.partners.map((p: Record<string, unknown>) => [
        String(p.company_name ?? ''),
        String(p.contact_name ?? ''),
        String(p.contact_title ?? ''),
        String(p.contact_email ?? ''),
        String(p.contact_linkedin ?? ''),
        String(p.domain ?? ''),
        String(p.source ?? ''),
        String(p.partner_type ?? ''),
        String(p.network_distance ?? ''),
        String(p.weighted_score ?? ''),
        String(p.status ?? ''),
        String(p.email_status ?? ''),
        String(p.contact_source ?? ''),
        String(p.created_at ?? ''),
      ]);

      const csvContent = [headers, ...rows]
        .map((row: string[]) => row.map((cell: string) => `"${cell.replace(/"/g, '""')}"`).join(','))
        .join('\n');

      // Leading BOM so Excel opens UTF-8 correctly (accented names etc).
      const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `prospects-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
      alert(`Export failed: ${err instanceof Error ? err.message : 'network error'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={loading || count === 0}
      className="btn-secondary flex items-center gap-2"
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
      Export CSV ({count})
    </button>
  );
}