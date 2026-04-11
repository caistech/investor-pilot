'use client';

import Image from 'next/image';
import { useState } from 'react';
import { getCompanyLogoUrl } from '@/lib/utils';

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

  if (failed) {
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
