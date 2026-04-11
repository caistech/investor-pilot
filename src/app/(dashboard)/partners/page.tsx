import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { STATUS_COLORS } from '@/lib/types';
import type { Partner, PartnerStatus } from '@/lib/types';
import { CompanyLogo } from '@/components/company-logo';

export default async function PartnersPage() {
  const supabase = createClient();
  const { data: profile } = await supabase.from('profiles').select('organisation_id').single();

  if (!profile?.organisation_id) return <p>Loading...</p>;

  const { data: partners } = await supabase
    .from('partners')
    .select('*')
    .eq('organisation_id', profile.organisation_id)
    .eq('screened_out', false)
    .order('weighted_score', { ascending: false, nullsFirst: false });

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1>Partners</h1>
          <p className="text-dark-400 mt-1">{partners?.length || 0} partners in pipeline</p>
        </div>
      </div>

      {partners && partners.length > 0 ? (
        <div className="card overflow-hidden p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-dark-700">
                <th className="text-left text-dark-400 text-sm font-medium px-6 py-3">Company</th>
                <th className="text-left text-dark-400 text-sm font-medium px-6 py-3">Category</th>
                <th className="text-left text-dark-400 text-sm font-medium px-6 py-3">Score</th>
                <th className="text-left text-dark-400 text-sm font-medium px-6 py-3">Contact</th>
                <th className="text-left text-dark-400 text-sm font-medium px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {(partners as Partner[]).map((p) => (
                <tr key={p.id} className="border-b border-dark-800 last:border-0 hover:bg-dark-800/50">
                  <td className="px-6 py-3">
                    <Link href={`/partners/${p.id}`} className="flex items-center gap-3 hover:text-corp-green-400">
                      {p.domain ? (
                        <CompanyLogo domain={p.domain} companyName={p.company_name} size={24} />
                      ) : (
                        <div className="w-6 h-6 bg-dark-700 rounded flex items-center justify-center text-xs font-bold">
                          {p.company_name[0]}
                        </div>
                      )}
                      <span className="font-medium">{p.company_name}</span>
                    </Link>
                  </td>
                  <td className="px-6 py-3 text-dark-400 text-sm">{p.category || '—'}</td>
                  <td className="px-6 py-3">
                    <span className="font-mono">{p.weighted_score?.toFixed(1) ?? '—'}</span>
                    {p.confidence_score === 'low-confidence' && (
                      <span className="text-amber-400 text-xs ml-1">low</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-sm">
                    {p.contact_name ? (
                      <div>
                        <div>{p.contact_name}</div>
                        <div className="text-dark-500">{p.contact_email || 'no email'}</div>
                      </div>
                    ) : (
                      <span className="text-dark-500">—</span>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <span className={STATUS_COLORS[p.status as PartnerStatus]}>
                      {p.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card text-center py-16">
          <p className="text-dark-400 text-lg">No partners discovered yet</p>
          <p className="text-dark-500 mt-2">Start an agent session to discover and score potential partners.</p>
          <Link href="/sessions" className="btn-primary inline-block mt-4">Start a Session</Link>
        </div>
      )}
    </div>
  );
}
