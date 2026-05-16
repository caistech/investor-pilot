'use client';

import { useEffect, useState } from 'react';
import { X, PlayCircle } from 'lucide-react';

const DISMISS_KEY = 'investorpilot:dashboard-heygen-dismissed-at';
const SHOW_AGAIN_AFTER_DAYS = 30;

interface VideoState {
  loading: boolean;
  url: string | null;
  unconfigured: boolean;
}

/**
 * Dashboard hero — embeds the Heygen-generated explainer video at the top
 * of /dashboard. Dismissible via the X button; dismissal stored in
 * localStorage and respected for SHOW_AGAIN_AFTER_DAYS (after which the
 * hero re-appears, e.g. when copy gets refreshed).
 *
 * Hidden entirely when:
 *   - HEYGEN_VIDEO_ID is unset on the server (returns ok:false, status:'unconfigured')
 *   - The video isn't ready yet (status:'pending'|'processing')
 *   - The user has dismissed within the last 30 days
 *   - The video state hasn't loaded yet (avoids a flash of empty hero)
 */
export function HeygenHero() {
  const [video, setVideo] = useState<VideoState>({ loading: true, url: null, unconfigured: false });
  const [dismissed, setDismissed] = useState<boolean>(true); // start dismissed; re-evaluate on mount

  useEffect(() => {
    // Read dismissal state from localStorage. SSR-safe — useEffect only runs client-side.
    try {
      const stored = window.localStorage.getItem(DISMISS_KEY);
      if (stored) {
        const dismissedAt = new Date(stored).getTime();
        const ageDays = (Date.now() - dismissedAt) / (1000 * 60 * 60 * 24);
        setDismissed(ageDays < SHOW_AGAIN_AFTER_DAYS);
      } else {
        setDismissed(false);
      }
    } catch {
      setDismissed(false);
    }

    // Fetch the playable URL from the server (which calls Heygen status endpoint).
    fetch('/api/dashboard/heygen-video')
      .then((r) => r.json())
      .then((data: { ok: boolean; url?: string; status?: string }) => {
        if (data.ok && data.url) {
          setVideo({ loading: false, url: data.url, unconfigured: false });
        } else {
          setVideo({
            loading: false,
            url: null,
            unconfigured: data.status === 'unconfigured',
          });
        }
      })
      .catch(() => setVideo({ loading: false, url: null, unconfigured: false }));
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, new Date().toISOString());
    } catch {
      // localStorage may be blocked (incognito with strict settings) — ignore.
    }
    setDismissed(true);
  }

  // Hide entirely until we know whether to render.
  if (video.loading || dismissed || !video.url) return null;

  return (
    <div className="card mb-6 relative overflow-hidden">
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-dark-800/80 hover:bg-dark-700 text-dark-400 hover:text-white transition-colors"
        aria-label="Dismiss video"
        title="Dismiss (won't show again for 30 days)"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-center gap-2 mb-3 text-sm text-dark-400">
        <PlayCircle className="w-4 h-4 text-corp-green-400" />
        Welcome to InvestorPilot — quick tour
      </div>
      <video
        src={video.url}
        controls
        playsInline
        preload="metadata"
        className="w-full rounded-lg bg-black"
        style={{ maxHeight: '480px' }}
      >
        <track kind="captions" />
        Your browser doesn't support embedded video. <a href={video.url}>Download</a>
      </video>
    </div>
  );
}
