'use client';

import Image from 'next/image';
import { useState } from 'react';
import { getCompanyLogoUrl } from '@/lib/utils';

// LinkedIn-sourced rows don't have a real company website — we store a
// synthetic 'linkedin.com/in/<slug>' value as their domain. Hunter's logo
// service rejects those as not-a-real-domain (400) and Next/Image surfaces
// the error in console. Detect upfront and render a placeholder so we
// never hit Hunter for these pseudo-domains.
function isLinkedInPseudoDomain(domain: string | null | undefined): boolean {
  if (!domain) return true;
  return domain.startsWith('linkedin.com/in/') || domain.startsWith('linkedin-unknown-');
}

export function CompanyLogo({
  domain,
  companyName,
  size = 24,
  className = 'rounded',
}: {
  domain: string;
  companyName: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const skipLogo = isLinkedInPseudoDomain(domain);

  if (failed || skipLogo) {
    return (
      <div
        className={`bg-dark-700 ${className} flex items-center justify-center text-xs font-bold`}
        style={{ width: size, height: size }}
      >
        {companyName[0]}
      </div>
    );
  }

  return (
    <Image
      src={getCompanyLogoUrl(domain)!}
      alt={companyName}
      width={size}
      height={size}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
