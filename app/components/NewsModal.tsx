"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { FiX, FiRefreshCw } from "react-icons/fi";
import { PiNewspaper } from "react-icons/pi";
import type { NewsArticle, NewsImpact } from "../lib/news";
import { fmtTimeAgo } from "../lib/news";
import { MARKETS, type MarketKey } from "../lib/markets";
import { backdropVariants, modalVariants, fadeUpVariants, TRANSITION_BACKDROP, TRANSITION_BASE, TRANSITION_FAST } from "../lib/motionVariants";
import { glassStyle, glassChipStyle } from "../lib/glass";

const PAGE_SIZE = 15;

// Low impact gets no label at all — it's the default, and tagging every row
// with it was just noise. Red is a notch brighter than --down so the small
// label stays readable on navy.
const IMPACT_META: Record<NewsImpact, { label: string; color: string } | null> = {
  high:   { label: "HIGH IMPACT",   color: "#c0453d" },
  medium: { label: "MEDIUM IMPACT", color: "#c9a838" },
  low:    null,
};

// One row of the grouped feed list — meta line, headline, summary, markets,
// thumbnail on the right. The whole row is the link.
function ArticleCard({ article, index }: { article: NewsArticle; index: number }) {
  const impact = IMPACT_META[article.impact];
  return (
    <motion.a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 px-3.5 py-3 transition-colors duration-150 active:bg-white/5 lg:hover:bg-white/[0.03]"
      variants={fadeUpVariants}
      initial="hidden"
      animate="visible"
      transition={{ ...TRANSITION_FAST, delay: Math.min(index, 10) * 0.02 }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
          {impact && (
            <>
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: impact.color }} />
              <span style={{ color: impact.color }}>{impact.label}</span>
              <span>·</span>
            </>
          )}
          <span className="truncate">{article.source}</span>
          <span className="shrink-0">· {fmtTimeAgo(article.datetime)}</span>
        </div>
        <p className="mt-1 text-sm lg:text-base font-semibold leading-snug line-clamp-3" style={{ color: "var(--text-primary)" }}>
          {article.headline}
        </p>
        {article.summary && (
          <p className="mt-1 text-xs lg:text-sm leading-snug line-clamp-2" style={{ color: "var(--text-secondary)" }}>{article.summary}</p>
        )}
        <div className="mt-1.5 text-[10px] font-black tracking-wider" style={{ color: "var(--text-muted)", fontFamily: "var(--font-display)" }}>
          {article.relevantTo.map(key => MARKETS[key].short).join("  ·  ")}
        </div>
      </div>
      {article.image && (
        // eslint-disable-next-line @next/next/no-img-element -- external, unpredictable-domain thumbnails from the news API; not worth next/image's remote-pattern config for a small feed thumbnail
        <img
          src={article.image}
          alt=""
          className="w-[72px] h-[72px] lg:w-20 lg:h-20 rounded-lg object-cover shrink-0 self-start mt-0.5"
          style={{ background: "var(--bg-elevated)" }}
          onError={e => { e.currentTarget.style.display = "none"; }}
        />
      )}
    </motion.a>
  );
}

// The feed itself — header (title + refresh, plus CLOSE when onClose is given)
// and the article list. Rendered inside NewsModal on desktop, and directly as
// the News screen of the mobile bottom tab bar. `active` = visible right now;
// the first fetch waits for it so news nobody opens is never loaded.
export function NewsFeed({ market, active, onClose }: { market: MarketKey; active: boolean; onClose?: () => void }) {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  // Lets an in-flight fetch detect the user has since switched markets and
  // bail instead of applying a wrong-market response — every other fetch in
  // the app guards this way already (BobbyPanel's analyze(), Dashboard's
  // market-load effect), this one was missing it.
  const marketRef = useRef(market);
  useEffect(() => { marketRef.current = market; }, [market]);

  const load = useCallback(async (refresh: boolean) => {
    const requestMarket = market;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/news?market=${requestMarket}${refresh ? "&refresh=1" : ""}`, { cache: "no-store" });
      const data = await res.json();
      // Switched markets mid-flight — discard this response entirely,
      // including `loaded`, so the market-reset effect's `loaded: false`
      // still stands and the auto-load effect fires a fresh fetch for
      // whatever market is now current instead of thinking it's done.
      if (marketRef.current !== requestMarket) return;
      if (!res.ok) throw new Error(data.error ?? "Failed to load news");
      setArticles(data.articles ?? []);
      setVisibleCount(PAGE_SIZE);
      setLoaded(true);
    } catch (e: unknown) {
      // Same staleness check here — otherwise an old market's failed
      // request could paint an error message over the new market's screen.
      if (marketRef.current === requestMarket) {
        setError(e instanceof Error ? e.message : "Failed to load news");
        setLoaded(true); // still — a failure must stop the auto-load retry loop
      }
    } finally {
      // Always clear the spinner for this call, even if stale — otherwise a
      // discarded response leaves `loading` stuck true and the auto-load
      // effect for the new market can never fire (its guard requires !loading).
      setLoading(false);
    }
  }, [market]);

  // Switching markets invalidates whatever was loaded for the previous one
  // — the server-side cache makes the refetch cheap, it's just a re-filter
  // of already-fetched data (see /api/news), not a fresh Finnhub hit.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setLoaded(false);
    setArticles([]);
  }, [market]);

  // Lazy-load on first open (or after a market change resets `loaded`) —
  // avoids fetching news that's never viewed if the user never taps the
  // ticker this session.
  useEffect(() => {
    if (active && !loaded && !loading) load(false);
  }, [active, loaded, loading, load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-7 lg:py-5 shrink-0">
        <div>
          <div className="flex items-center gap-2 font-black text-base lg:text-xl tracking-[0.25em]" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
            <PiNewspaper size={18} /> NEWS
          </div>
          <div className="text-xs lg:text-base mt-0.5" style={{ color: "var(--text-secondary)" }}>Only what moves NASDAQ, Dow, Gold & Bitcoin</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            disabled={loading}
            title="Refresh news"
            className="flex items-center justify-center w-9 h-9 rounded"
            style={{ ...glassChipStyle(), color: "var(--text-secondary)", cursor: loading ? "not-allowed" : "pointer" }}
          >
            <FiRefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-bold"
              style={{ ...glassChipStyle(), color: "var(--text-secondary)", cursor: "pointer" }}
            >
              <FiX size={13} /> CLOSE
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 lg:px-5 lg:pb-5">
        {error ? (
          <div className="py-12 flex flex-col items-center text-center" style={{ color: "var(--text-secondary)" }}>
            <PiNewspaper size={36} className="mb-3 opacity-20" />
            <p className="text-sm">{error}</p>
          </div>
        ) : loading && articles.length === 0 ? (
          <div className="py-12 flex flex-col items-center text-center" style={{ color: "var(--text-secondary)" }}>
            <FiRefreshCw size={22} className="mb-3 animate-spin opacity-40" />
            <p className="text-sm">Loading news…</p>
          </div>
        ) : articles.length === 0 ? (
          <div className="py-12 flex flex-col items-center text-center" style={{ color: "var(--text-secondary)" }}>
            <PiNewspaper size={36} className="mb-3 opacity-20" />
            <p className="text-sm">No relevant news right now.</p>
            <p className="text-xs mt-1 opacity-70">Nothing moving NASDAQ, Dow, Gold, or Bitcoin at the moment.</p>
          </div>
        ) : (
          <>
            {/* Grouped list — one surface, hairline separators, like an iOS inset list */}
            <div className="rounded-lg overflow-hidden divide-y divide-white/[0.06]" style={glassStyle()}>
              {articles.slice(0, visibleCount).map((a, i) => (
                <ArticleCard key={a.id} article={a} index={i} />
              ))}
            </div>
            {visibleCount < articles.length && (
              <button
                onClick={() => setVisibleCount(v => v + PAGE_SIZE)}
                className="w-full mt-2 h-10 rounded-lg text-xs font-bold tracking-wider"
                style={{ color: "var(--text-secondary)", cursor: "pointer" }}
              >
                SHOW MORE
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function NewsModal({ open, onClose, market }: { open: boolean; onClose: () => void; market: MarketKey }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end lg:items-center justify-center lg:p-6"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={onClose}
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          transition={TRANSITION_BACKDROP}
        >
          <motion.div
            className="w-full lg:max-w-2xl h-[92dvh] lg:h-[88vh] rounded-t-md lg:rounded-md overflow-hidden flex flex-col"
            style={{ ...glassStyle(), boxShadow: "0 -8px 60px rgba(0,0,0,0.5)" }}
            onClick={e => e.stopPropagation()}
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={TRANSITION_BASE}
          >
            {/* Mobile drag handle */}
            <div className="lg:hidden flex justify-center pt-2 shrink-0">
              <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />
            </div>

            <NewsFeed market={market} active={open} onClose={onClose} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
