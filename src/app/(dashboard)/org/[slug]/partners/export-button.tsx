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
      
      if (data.partners && data.partners.length > 0) {
        const headers = ['Name', 'Company', 'Email', 'Phone', 'LinkedIn', 'Source', 'Score', 'Status', 'Network Distance', 'Email Source', 'Created'];
        const rows = data.partners.map((p: Record<string, unknown>) => [
          String(p.name ?? ''),
          String(p.company_name ?? ''),
          String(p.contact_email ?? ''),
          String(p.contact_phone ?? ''),
          String(p.contact_linkedin ?? ''),
          String(p.source ?? ''),
          String(p.weighted_score ?? ''),
          String(p.status ?? ''),
          String(p.network_distance ?? ''),
          String(p.email_source ?? ''),
          String(p.created_at ?? ''),
        ]);
        
        const csvContent = [headers, ...rows]
          .map((row: string[]) => row.map((cell: string) => `"${cell.replace(/"/g, '""')}"`).join(','))
          .join('\n');
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `prospects-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Export failed:', err);
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
