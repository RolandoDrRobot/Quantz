"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { FiX, FiRefreshCw, FiExternalLink } from "react-icons/fi";
import { LuNewspaper } from "react-icons/lu";
import type { NewsArticle, NewsImpact } from "../lib/news";
import { fmtTimeAgo } from "../lib/news";
import { MARKETS, type MarketKey } from "../lib/markets";
import { backdropVariants, modalVariants, fadeUpVariants, TRANSITION_BACKDROP, TRANSITION_BASE, TRANSITION_FAST } from "../lib/motionVariants";
import { glassStyle, glassChipStyle } from "../lib/glass";

const PAGE_SIZE = 15;

const IMPACT_META: Record<NewsImpact, { label: string; color: string }> = {
  high:   { label: "HIGH IMPACT",   color: "#8a2f2a" },
  medium: { label: "MEDIUM IMPACT", color: "#c9a838" },
  low:    { label: "LOW IMPACT",    color: "var(--text-muted)" },
};

function ArticleCard({ article, index }: { article: NewsArticle; index: number }) {
  return (
    <motion.a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 rounded-lg p-3 transition-colors"
      style={glassChipStyle(IMPACT_META[article.impact].color !== "var(--text-muted)" ? IMPACT_META[article.impact].color : undefined)}
      variants={fadeUpVariants}
      initial="hidden"
      animate="visible"
      transition={{ ...TRANSITION_FAST, delay: Math.min(index, 10) * 0.02 }}
    >
      {article.image && (
        // eslint-disable-next-line @next/next/no-img-element -- external, unpredictable-domain thumbnails from the news API; not worth next/image's remote-pattern config for a small feed thumbnail
        <img
          src={article.image}
          alt=""
          className="w-20 h-20 rounded-md object-cover shrink-0"
          style={{ background: "var(--bg-elevated)" }}
          onError={e => { e.currentTarget.style.display = "none"; }}
        />
      )}
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-bold leading-snug" style={{ color: "var(--text-primary)" }}>{article.headline}</p>
          <span
            className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-black tracking-wider whitespace-nowrap"
            style={{ background: `${IMPACT_META[article.impact].color}22`, color: IMPACT_META[article.impact].color, border: `1px solid ${IMPACT_META[article.impact].color}44` }}
          >
            {IMPACT_META[article.impact].label}
          </span>
        </div>
        {article.summary && (
          <p className="text-[13px] leading-snug line-clamp-2" style={{ color: "var(--text-secondary)" }}>{article.summary}</p>
        )}
        <div className="flex items-center gap-2 flex-wrap mt-0.5">
          <span className="text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>{article.source}</span>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>· {fmtTimeAgo(article.datetime)}</span>
          {article.relevantTo.map(key => (
            <span
              key={key}
              className="px-1.5 py-0.5 rounded text-[10px] font-black tracking-wider"
              style={{ background: `${MARKETS[key].color}22`, color: MARKETS[key].color }}
            >
              {MARKETS[key].short}
            </span>
          ))}
          <FiExternalLink size={11} style={{ color: "var(--text-muted)" }} className="ml-auto" />
        </div>
      </div>
    </motion.a>
  );
}

export default function NewsModal({ open, onClose, market }: { open: boolean; onClose: () => void; market: MarketKey }) {
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
    if (open && !loaded && !loading) load(false);
  }, [open, loaded, loading, load]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
            className="w-full lg:max-w-2xl h-[92dvh] lg:h-[88vh] rounded-t-lg lg:rounded-lg overflow-hidden flex flex-col"
            style={{ ...glassStyle(), boxShadow: "0 -8px 60px rgba(0,0,0,0.5)" }}
            onClick={e => e.stopPropagation()}
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={TRANSITION_BASE}
          >
            {/* Mobile drag handle */}
            <div className="lg:hidden flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-7 py-5 shrink-0" style={{ borderBottom: "1px solid var(--glass-border)" }}>
              <div>
                <div className="flex items-center gap-2 font-black text-xl tracking-[0.25em]" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
                  <LuNewspaper size={18} /> NEWS
                </div>
                <div className="text-base mt-0.5" style={{ color: "var(--text-secondary)" }}>Only what moves NASDAQ, Dow, Gold, Bitcoin & Ethereum</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => load(true)}
                  disabled={loading}
                  title="Refresh news"
                  className="flex items-center justify-center w-9 h-9 rounded-md"
                  style={{ ...glassChipStyle(), color: "var(--text-secondary)", cursor: loading ? "not-allowed" : "pointer" }}
                >
                  <FiRefreshCw size={14} className={loading ? "animate-spin" : ""} />
                </button>
                <button
                  onClick={onClose}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-bold"
                  style={{ ...glassChipStyle(), color: "var(--text-secondary)", cursor: "pointer" }}
                >
                  <FiX size={13} /> CLOSE
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-5 flex flex-col gap-2.5">
              {error ? (
                <div className="py-16 flex flex-col items-center text-center" style={{ color: "var(--text-secondary)" }}>
                  <LuNewspaper size={48} className="mb-4 opacity-15" />
                  <p className="text-lg">{error}</p>
                </div>
              ) : loading && articles.length === 0 ? (
                <div className="py-16 flex flex-col items-center text-center" style={{ color: "var(--text-secondary)" }}>
                  <FiRefreshCw size={32} className="mb-4 animate-spin opacity-40" />
                  <p className="text-base">Loading news...</p>
                </div>
              ) : articles.length === 0 ? (
                <div className="py-16 flex flex-col items-center text-center" style={{ color: "var(--text-secondary)" }}>
                  <LuNewspaper size={48} className="mb-4 opacity-15" />
                  <p className="text-lg">No relevant news right now.</p>
                  <p className="text-base mt-2 opacity-70">Nothing moving NASDAQ, Dow, Gold, Bitcoin, or Ethereum at the moment.</p>
                </div>
              ) : (
                <>
                  {articles.slice(0, visibleCount).map((a, i) => (
                    <ArticleCard key={a.id} article={a} index={i} />
                  ))}
                  {visibleCount < articles.length && (
                    <button
                      onClick={() => setVisibleCount(v => v + PAGE_SIZE)}
                      className="mt-2 py-3 rounded-md text-sm font-bold tracking-wider"
                      style={{ ...glassChipStyle(), color: "var(--text-secondary)", cursor: "pointer" }}
                    >
                      LOAD MORE
                    </button>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
