"use client";

import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { FiX, FiRefreshCw, FiExternalLink } from "react-icons/fi";
import { LuNewspaper } from "react-icons/lu";
import type { NewsArticle } from "../lib/news";
import { fmtTimeAgo } from "../lib/news";
import { MARKETS, type MarketKey } from "../lib/markets";
import { backdropVariants, modalVariants, fadeUpVariants, TRANSITION_BACKDROP, TRANSITION_BASE, TRANSITION_FAST } from "../lib/motionVariants";

const PAGE_SIZE = 15;

function ArticleCard({ article, index }: { article: NewsArticle; index: number }) {
  return (
    <motion.a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 rounded-lg p-3 transition-colors"
      style={{ background: "var(--bg-card)", border: "1px solid rgba(255,255,255,0.06)" }}
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
        <p className="text-sm font-bold leading-snug" style={{ color: "var(--text-primary)" }}>{article.headline}</p>
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

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/news?market=${market}${refresh ? "&refresh=1" : ""}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load news");
      setArticles(data.articles ?? []);
      setVisibleCount(PAGE_SIZE);
      setLoaded(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load news");
    } finally {
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
          style={{ background: "rgba(0,0,0,0.75)" }}
          onClick={onClose}
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          transition={TRANSITION_BACKDROP}
        >
          <motion.div
            className="w-full lg:max-w-2xl h-[92dvh] lg:h-[88vh] rounded-t-lg lg:rounded-lg overflow-hidden flex flex-col"
            style={{ background: "var(--bg-panel)", border: "1px solid var(--gold-border)", boxShadow: "0 -8px 60px rgba(0,0,0,0.5)" }}
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
            <div className="flex items-center justify-between px-7 py-5 shrink-0" style={{ borderBottom: "1px solid var(--gold-border)" }}>
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
                  style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)", border: "1px solid rgba(255,255,255,0.1)", cursor: loading ? "not-allowed" : "pointer" }}
                >
                  <FiRefreshCw size={14} className={loading ? "animate-spin" : ""} />
                </button>
                <button
                  onClick={onClose}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-bold"
                  style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer" }}
                >
                  <FiX size={13} /> CLOSE
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-5 flex flex-col gap-2.5">
              {error ? (
                <div className="py-16 flex flex-col items-center text-center" style={{ color: "var(--text-muted)" }}>
                  <LuNewspaper size={48} className="mb-4 opacity-15" />
                  <p className="text-lg">{error}</p>
                </div>
              ) : loading && articles.length === 0 ? (
                <div className="py-16 flex flex-col items-center text-center" style={{ color: "var(--text-muted)" }}>
                  <FiRefreshCw size={32} className="mb-4 animate-spin opacity-40" />
                  <p className="text-base">Loading news...</p>
                </div>
              ) : articles.length === 0 ? (
                <div className="py-16 flex flex-col items-center text-center" style={{ color: "var(--text-muted)" }}>
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
                      style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer" }}
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
