"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { FiHelpCircle, FiX } from "react-icons/fi";
import type { RawCandle } from "../api/market/route";
import type { Level, TradeSetup, BreakoutEvent } from "../lib/analysis";
import { popVariants, fadeUpVariants, TRANSITION_FAST, TRANSITION_BASE } from "../lib/motionVariants";
import { fmtPrice } from "../lib/format";
import { glassChipStyle, glassStyle } from "../lib/glass";

// ─── AXE CAPITAL Palette — navy + brand red ──────────────────────────────────
const P = {
  bg:        "#050e1a",
  bgLabel:   "#0d2338",
  grid:      "#0d2338",
  text:      "#58636f",

  upBody:    "#1a7346",
  upBorder:  "#1a7346",
  upWick:    "#1a7346",
  downBody:  "#8a2f2a",
  downBorder:"#8a2f2a",
  downWick:  "#8a2f2a",

  crosshair: "rgba(194,59,48,0.22)",

  // Analysis lines at 0.7 opacity — visible but never in the way of the tape
  resistance: "rgba(138,47,42,0.7)",
  support:    "rgba(28,125,76,0.7)",

  entry: "rgba(212,167,44,0.7)",
  sl:    "rgba(138,47,42,0.7)",
  tp:    "rgba(28,125,76,0.7)",
};

const TD_API_KEY = process.env.NEXT_PUBLIC_TWELVEDATA_API_KEY;

interface Props {
  candles: RawCandle[];
  levels: Level[];
  ma20: number;
  tradeSetup: TradeSetup | null;
  breakout: BreakoutEvent | null;
  accentColor?: string;
  symbol: string;
  tdSymbol: string | null;
  coinbaseProduct?: string | null;
  onTick?: (price: number) => void;
  stale?: boolean;
}

const LEGEND = [
  { color: P.upBorder,    label: "Bullish candle", style: "solid" },
  { color: P.downBorder,  label: "Bearish candle", style: "solid" },
  { color: "rgba(194,59,48,0.6)", label: "MA 20 (trend)", style: "solid" },
  { color: "rgba(26,115,70,0.55)", label: "Volume (if the instrument reports it)", style: "solid" },
  { color: P.resistance,  label: "Resistance",     style: "solid" },
  { color: P.support,     label: "Support",        style: "solid" },
  { color: P.entry,       label: "Entry",          style: "dashed" },
  { color: P.sl,          label: "Stop Loss",      style: "solid" },
  { color: P.tp,          label: "Take Profit",    style: "solid" },
];

export default function AxeChart({ candles, levels, ma20, tradeSetup, breakout, accentColor = "#c23b30", symbol, tdSymbol, coinbaseProduct, onTick, stale = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef  = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const maSeriesRef   = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const volSeriesRef  = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priceLinesRef = useRef<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roRef = useRef<any>(null);
  // Cached once the chart effect's dynamic import resolves — the overlay
  // effect below needs LW.LineSeries/LW.LineStyle too, but re-importing is
  // pointless (the module is already loaded; import() just resolves the
  // cached instance), so it reads from here instead of importing again.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const LWRef = useRef<any>(null);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [showLegend, setShowLegend] = useState(false);
  const onTickRef = useRef(onTick);
  const candlesRef = useRef(candles);
  useEffect(() => { onTickRef.current = onTick; }, [onTick]);
  useEffect(() => { candlesRef.current = candles; }, [candles]);

  // ── Overlay refresh — S/R lines, entry/SL/TP, breakout zone, MA. Kept as a
  // ref-mirrored function, reassigned in the effect below (never during
  // render — refs can't be written mid-render) so it always closes over the
  // latest props, rather than inline in one effect, because it's called from
  // two places: once by the chart-lifecycle effect right after building a
  // fresh chart, and once right here on every analysis update. Never touches
  // the chart/series instances themselves.
  const refreshOverlayRef = useRef<() => void>(() => {});
  useEffect(() => {
    refreshOverlayRef.current = () => {
    const LW = LWRef.current;
    const cs = seriesRef.current;
    const activeChart = chartRef.current;
    if (!LW || !cs || !activeChart) return;

    priceLinesRef.current.forEach(pl => { try { cs.removePriceLine(pl); } catch { /* ignore */ } });
    priceLinesRef.current = [];
    if (maSeriesRef.current) { try { activeChart.removeSeries(maSeriesRef.current); } catch { /* ignore */ } maSeriesRef.current = null; }

    if (ma20 > 0) {
      const seen2 = new Set<number>();
      const clean2 = candles
        .filter(c => { if (seen2.has(c.time)) return false; seen2.add(c.time); return true; })
        .sort((a, b) => a.time - b.time)
        .map(c => ({ time: c.time as number, close: c.close }));
      if (clean2.length >= 20) {
        const maSeries = activeChart.addSeries(LW.LineSeries, {
          color: accentColor + "55", lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        // Rolling sum instead of re-summing a 20-candle slice per point —
        // this overlay re-runs on every analysis tick (every ~2.5s as price
        // moves), not just on genuine candle-set changes, so O(n) matters.
        const maData: { time: number; value: number }[] = [];
        let rollingSum = 0;
        for (let i = 0; i < clean2.length; i++) {
          rollingSum += clean2[i].close;
          if (i >= 20) rollingSum -= clean2[i - 20].close;
          if (i >= 19) maData.push({ time: clean2[i].time, value: rollingSum / 20 });
        }
        maSeries.setData(maData);
        maSeriesRef.current = maSeries;
      }
    }

    const addLine = (opts: object) => { priceLinesRef.current.push(cs.createPriceLine(opts)); };

    const seen3 = new Set<number>();
    const cleanPrices = candles
      .filter(c => { if (seen3.has(c.time)) return false; seen3.add(c.time); return true; })
      .sort((a, b) => a.time - b.time);
    const currentPrice = cleanPrices[cleanPrices.length - 1]?.close ?? 0;
    // Tight enough to only catch "basically the same line" (rounding/
    // clustering artifacts) — the old 0.06% was 30-40% of a typical
    // instrument's SL distance and could hide a genuinely distinct nearby
    // S/R level under the entry/SL/TP lines.
    const eps = currentPrice * 0.00015;
    const near = (a: number, b: number) => Math.abs(a - b) < eps;

    const entryIsBrokenLevel = !!(tradeSetup && breakout && near(tradeSetup.entryPrice, breakout.level));
    const taken: number[] = [];
    if (tradeSetup) taken.push(tradeSetup.entryPrice, tradeSetup.stopLoss, tradeSetup.takeProfit);
    if (breakout) taken.push(breakout.level);

    const topR = levels
      .filter(l => l.type === "resistance" && l.price > currentPrice && !taken.some(p => near(p, l.price)))
      .sort((a, b) => b.strength - a.strength)[0];
    const topS = levels
      .filter(l => l.type === "support" && l.price < currentPrice && !taken.some(p => near(p, l.price)))
      .sort((a, b) => b.strength - a.strength)[0];

    if (topR) addLine({ price: topR.price, color: P.resistance, lineWidth: 1, lineStyle: LW.LineStyle.Solid,  axisLabelVisible: true, title: "R" });
    if (topS) addLine({ price: topS.price, color: P.support,    lineWidth: 1, lineStyle: LW.LineStyle.Solid,  axisLabelVisible: true, title: "S" });

    if (tradeSetup) {
      addLine({ price: tradeSetup.entryPrice, color: P.entry, lineWidth: 2, lineStyle: LW.LineStyle.Dashed, axisLabelVisible: true, title: tradeSetup.direction === "long" ? "E▲" : "E▼" });
      addLine({ price: tradeSetup.stopLoss,   color: P.sl,    lineWidth: 2, lineStyle: LW.LineStyle.Solid,  axisLabelVisible: true, title: "SL" });
      addLine({ price: tradeSetup.takeProfit, color: P.tp,    lineWidth: 2, lineStyle: LW.LineStyle.Solid,  axisLabelVisible: true, title: "TP" });
    }

    if (breakout) {
      const bColor = breakout.direction === "long" ? "rgba(42,150,95,0.7)" : "rgba(196,74,64,0.7)";
      const bZone  = breakout.direction === "long" ? "rgba(42,150,95,0.25)" : "rgba(196,74,64,0.25)";
      if (!entryIsBrokenLevel) addLine({ price: breakout.level, color: bColor, lineWidth: 2, lineStyle: LW.LineStyle.Dashed, axisLabelVisible: true, title: breakout.direction === "long" ? "B▲" : "B▼" });
      addLine({ price: breakout.level + breakout.retestZone, color: bZone, lineWidth: 1, lineStyle: LW.LineStyle.Dotted, axisLabelVisible: false, title: "" });
      addLine({ price: breakout.level - breakout.retestZone, color: bZone, lineWidth: 1, lineStyle: LW.LineStyle.Dotted, axisLabelVisible: false, title: "" });
    }
    };
    refreshOverlayRef.current();
  }, [candles, levels, ma20, tradeSetup, breakout, accentColor]);

  // ── Chart + candlestick/volume series lifecycle — rebuilds ONLY when the
  // candle set itself changes (market switch, timeframe toggle, initial
  // load). Deliberately excludes levels/tradeSetup/breakout/ma20 from its
  // deps: those now update automatically every couple seconds as price
  // moves (see Dashboard's auto-analysis engine), and used to live in this
  // same effect — every recompute re-ran this effect, whose cleanup
  // unconditionally tore the chart down, forcing a full rebuild (including
  // fitContent/setVisibleLogicalRange) that reset the user's zoom/pan back
  // to the default view on every single analysis tick. The overlay now
  // lives in refreshOverlayRef above and its own effect below, which only
  // touches price lines — never the chart or candlestick series instance.
  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let chart: any = null;
    let cancelled = false;

    async function run() {
      const LW = await import("lightweight-charts");

      // The effect can re-fire (fast market switching, a new candles prop
      // arriving) while the dynamic import above is still in flight. Without
      // this check a stale run would resume afterward, remove the chart the
      // newer run already built, and overwrite chartRef.current with its own
      // stale candles — silently reverting the UI to outdated data.
      if (cancelled) return;
      LWRef.current = LW;

      // The container can unmount while the dynamic import above is in
      // flight (fast market switching, Fast Refresh) — bail rather than
      // dereference a null ref.
      const el = containerRef.current;
      if (!el) return;

      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
      priceLinesRef.current = [];
      maSeriesRef.current = null;
      seriesRef.current = null;
      volSeriesRef.current = null;

      chart = LW.createChart(el, {
        width:  el.clientWidth,
        height: el.clientHeight,
        layout: { background: { type: LW.ColorType.Solid, color: P.bg }, textColor: P.text, fontSize: window.innerWidth < 1024 ? 11 : 13 },
        grid: { vertLines: { color: P.grid }, horzLines: { color: P.grid } },
        crosshair: {
          mode: LW.CrosshairMode.Normal,
          vertLine: { color: P.crosshair, labelBackgroundColor: P.bgLabel, width: 1, style: LW.LineStyle.Dashed },
          horzLine: { color: P.crosshair, labelBackgroundColor: P.bgLabel, width: 1, style: LW.LineStyle.Dashed },
        },
        // Bottom margin reserves room for the volume histogram, which
        // overlays this same pane on its own (bottom-anchored) price scale.
        rightPriceScale: { borderColor: P.grid, scaleMargins: { top: 0.1, bottom: 0.24 } },
        // Thousands-grouped axis/crosshair/tooltip labels (lightweight-charts'
        // own default formatter has no comma grouping — "29722.30" instead
        // of "29,722.30" on an instrument like NASDAQ or Dow).
        localization: { priceFormatter: fmtPrice },
        timeScale: {
          borderColor: P.grid,
          timeVisible: true,
          secondsVisible: false,
          tickMarkFormatter: (time: number) =>
            new Date(time * 1000).toLocaleTimeString("en-US", {
              timeZone: "America/Costa_Rica",
              hour: "2-digit", minute: "2-digit", hour12: true,
            }),
        },
      });
      chartRef.current = chart;

      const cs = chart.addSeries(LW.CandlestickSeries, {
        upColor: P.upBody, downColor: P.downBody,
        borderUpColor: P.upBorder, borderDownColor: P.downBorder,
        wickUpColor: P.upWick, wickDownColor: P.downWick,
      });
      const seen = new Set<number>();
      const clean = candles
        .filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true; })
        .sort((a, b) => a.time - b.time)
        .map(c => ({ time: c.time as number, open: c.open, high: c.high, low: c.low, close: c.close }));
      cs.setData(clean);
      seriesRef.current = cs;

      // During a genuinely flat/thin period (e.g. Gold pinned to a ~0.3pt
      // range for 90 straight minutes in quiet Asian-session hours) the
      // chart's autoscale zooms in so tight that ordinary tick noise looks
      // like a chaotic zigzag dominating the whole view. Floor the visible
      // range to 0.05% of price so quiet periods render as a calm, mostly
      // flat band instead — this doesn't touch the underlying data, only
      // how much vertical room the (unchanged) candles get to breathe in.
      cs.applyOptions({
        autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
          const res = original();
          if (!res?.priceRange) return res;
          const { minValue, maxValue } = res.priceRange;
          const mid = (minValue + maxValue) / 2;
          const minSpan = Math.abs(mid) * 0.0005;
          const span = maxValue - minValue;
          if (span < minSpan) {
            const pad = (minSpan - span) / 2;
            return { priceRange: { minValue: minValue - pad, maxValue: maxValue + pad } };
          }
          return res;
        },
      });

      // Not every source reports volume (e.g. a forex/index feed can come
      // back all-zero) — skip the histogram entirely rather than draw a
      // flat, meaningless zero pane for those instruments.
      const hasVolumeData = candles.some(c => c.volume > 0);
      if (hasVolumeData) {
        const vs = chart.addSeries(LW.HistogramSeries, {
          priceFormat: { type: "volume" },
          priceScaleId: "",
        });
        vs.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        const seenVol = new Set<number>();
        const volData = candles
          .filter(c => { if (seenVol.has(c.time)) return false; seenVol.add(c.time); return true; })
          .sort((a, b) => a.time - b.time)
          .map(c => ({
            time: c.time as number,
            value: c.volume,
            color: c.close >= c.open ? "rgba(26,115,70,0.55)" : "rgba(138,47,42,0.55)",
          }));
        vs.setData(volData);
        volSeriesRef.current = vs;
      }

      // Tighter default zoom for scalping — fewer bars on screen means
      // each candle reads bigger and price action is easier to react to.
      const barsToShow = 90;
      if (clean.length > barsToShow) {
        chart.timeScale().setVisibleLogicalRange({ from: clean.length - barsToShow, to: clean.length + 5 });
      } else {
        chart.timeScale().fitContent();
      }

      if (roRef.current) roRef.current.disconnect();
      roRef.current = new ResizeObserver(() => {
        if (el && chartRef.current) chartRef.current.applyOptions({ width: el.clientWidth, height: el.clientHeight });
      });
      roRef.current.observe(el);

      // Draw the current overlay immediately on this fresh chart instance —
      // the overlay effect below won't otherwise fire again on its own until
      // levels/tradeSetup/breakout/ma20 next change.
      refreshOverlayRef.current();
    }

    run();

    return () => {
      cancelled = true;
      roRef.current?.disconnect();
      roRef.current = null;
      seriesRef.current = null;
      maSeriesRef.current = null;
      volSeriesRef.current = null;
      priceLinesRef.current = [];
      if (chart) { chart.remove(); chartRef.current = null; }
    };
  }, [candles]);

  // ── Live data ────────────────────────────────────────────────────────────
  // Coinbase Exchange's public trade stream for Bitcoin; Twelve Data's WS
  // for everything else (indices, commodities, 24/5 real-time).
  useEffect(() => {
    if (!symbol) return;

    let cur: { time: number; open: number; high: number; low: number; close: number } | null = null;
    let curInterval = 0;

    const applyTick = (price: number, tsSec: number) => {
      if (!seriesRef.current || !isFinite(price) || price <= 0) return;
      const cds = candlesRef.current;

      // Reject an implausible single-tick print (a bad value from the feed)
      // before it can poison the currently-forming candle's wick — this is
      // what makes one glitched tick paint a giant, chart-dominating spike
      // right as you're watching it live.
      const lastKnown = cur?.close ?? cds[cds.length - 1]?.close;
      if (lastKnown && Math.abs(price - lastKnown) / lastKnown > 0.02) return;

      // Match the bucket size to whatever interval the loaded candles actually
      // use (1m or 5m) instead of assuming 1m — a mismatch here is what makes
      // the live tick paint extra malformed bars between the real candles.
      let intervalSec = 60;
      if (cds.length >= 2) {
        const diff = cds[cds.length - 1].time - cds[cds.length - 2].time;
        if (isFinite(diff) && diff > 0) intervalSec = diff;
      }
      if (intervalSec !== curInterval) { cur = null; curInterval = intervalSec; }
      const bucket = Math.floor(tsSec / intervalSec) * intervalSec;
      if (!cur || cur.time !== bucket) {
        cur = { time: bucket, open: price, high: price, low: price, close: price };
      } else {
        cur.high = Math.max(cur.high, price);
        cur.low = Math.min(cur.low, price);
        cur.close = price;
      }
      try { seriesRef.current.update({ ...cur }); } catch { /* skip */ }
      setLivePrice(price);
      onTickRef.current?.(price);
    };

    let ws: WebSocket | null = null;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatId: ReturnType<typeof setInterval> | null = null;

    if (coinbaseProduct) {
      // Coinbase Exchange's public "matches" feed — free, no key. Needs an
      // explicit subscribe message on open (unlike Binance's path-based
      // stream), no heartbeat required.
      const connect = () => {
        if (closed) return;
        ws = new WebSocket("wss://ws-feed.exchange.coinbase.com");
        ws.onopen = () => {
          ws?.send(JSON.stringify({ type: "subscribe", product_ids: [coinbaseProduct], channels: ["matches"] }));
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type !== "match" && msg.type !== "last_match") return;
            const price = parseFloat(msg.price);
            if (isFinite(price)) {
              const tsSec = typeof msg.time === "string" ? Math.floor(Date.parse(msg.time) / 1000) : Math.floor(Date.now() / 1000);
              applyTick(price, isFinite(tsSec) ? tsSec : Math.floor(Date.now() / 1000));
            }
          } catch { /* skip */ }
        };
        ws.onclose = () => { if (!closed) reconnectTimer = setTimeout(connect, 3000); };
        ws.onerror = () => { ws?.close(); };
      };
      connect();
    } else if (TD_API_KEY && tdSymbol) {
      const connect = () => {
        if (closed) return;
        ws = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${TD_API_KEY}`);
        ws.onopen = () => {
          ws?.send(JSON.stringify({ action: "subscribe", params: { symbols: tdSymbol } }));
          if (heartbeatId) clearInterval(heartbeatId);
          heartbeatId = setInterval(() => {
            if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: "heartbeat" }));
          }, 10000);
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.event === "price" && typeof msg.price === "number") {
              applyTick(msg.price, msg.timestamp ?? Math.floor(Date.now() / 1000));
            }
          } catch { /* skip */ }
        };
        ws.onclose = () => {
          if (heartbeatId) clearInterval(heartbeatId);
          if (!closed) reconnectTimer = setTimeout(connect, 3000);
        };
        ws.onerror = () => { ws?.close(); };
      };
      connect();
    }

    // Fallback: markets with no free real-time WebSocket actually available
    // poll a lightweight server-side proxy for Yahoo's live price instead.
    // Checks whether the Twelve Data WS branch above could actually run
    // (needs both a symbol AND a live key), not just whether `tdSymbol` is
    // set — otherwise a missing/revoked TD_API_KEY silently blacks out
    // NASDAQ/Dow's live price entirely: the WS branch skips itself, and the
    // old `!tdSymbol` check here also skipped the poll, since a truthy
    // `tdSymbol` looked like "already covered" even when it wasn't.
    let pollId: ReturnType<typeof setInterval> | null = null;
    const tdWsViable = !!(TD_API_KEY && tdSymbol);
    if (!coinbaseProduct && !tdWsViable) {
      const poll = async () => {
        try {
          const res = await fetch(`/api/tick?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
          if (!res.ok) return;
          const data = await res.json();
          if (typeof data.price === "number" && isFinite(data.price)) {
            applyTick(data.price, typeof data.time === "number" ? data.time : Math.floor(Date.now() / 1000));
          }
        } catch { /* skip — retried on next interval tick */ }
      };
      poll();
      pollId = setInterval(poll, 5000);
    }

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatId) clearInterval(heartbeatId);
      if (pollId) clearInterval(pollId);
      ws?.close();
    };
  }, [symbol, tdSymbol, coinbaseProduct]);

  return (
    <div className="relative w-full h-full" style={{ background: P.bg }}>
      <div ref={containerRef} className="w-full h-full" />

      {/* Live price badge — turns amber and stops pulsing when no tick source
          (WS or poll) has reported a price in 20s+, so a dead feed is visible
          instead of the chart just quietly going stale with no on-screen sign. */}
      <AnimatePresence>
        {livePrice !== null && (
          <motion.div
            className="absolute top-4 left-4 flex items-center gap-2 px-4 py-2 rounded"
            style={glassChipStyle(stale ? "#d98c14" : "#c23b30")}
            variants={popVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={TRANSITION_FAST}
          >
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${stale ? "" : "animate-pulse"}`} style={{ background: stale ? "#d98c14" : "#c23b30" }} />
            <span className="font-bold text-base tracking-wide" style={{ color: stale ? "#d98c14" : "#c23b30", fontFamily: "var(--font-display)" }}>
              {stale ? "STALE" : "LIVE"} &nbsp;{fmtPrice(livePrice)}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Legend toggle */}
      <button
        onClick={() => setShowLegend(v => !v)}
        className="absolute top-4 right-4 flex items-center gap-1.5 px-4 py-2 rounded text-sm font-bold tracking-wider"
        style={{ ...glassChipStyle("#c23b30"), color: "#c23b30", cursor: "pointer" }}
      >
        {showLegend ? <FiX size={13} /> : <FiHelpCircle size={13} />} LEGEND
      </button>

      {/* Legend panel */}
      <AnimatePresence>
        {showLegend && (
          <motion.div
            className="absolute top-14 right-4 rounded p-5 flex flex-col gap-4"
            style={{ ...glassStyle(), minWidth: 210 }}
            variants={fadeUpVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={TRANSITION_BASE}
          >
            <div className="text-sm font-bold tracking-widest mb-1" style={{ color: "#c23b30" }}>WHAT EACH LINE MEANS</div>
            {LEGEND.map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                {/* Line preview */}
                <div className="flex items-center gap-0.5 flex-shrink-0 w-10">
                  {item.style === "dashed" ? (
                    <>
                      <div className="h-0.5 w-3 rounded" style={{ background: item.color }} />
                      <div className="h-0.5 w-1 rounded opacity-0" />
                      <div className="h-0.5 w-3 rounded" style={{ background: item.color }} />
                    </>
                  ) : (
                    <div className="h-0.5 w-10 rounded" style={{ background: item.color }} />
                  )}
                </div>
                <span className="text-sm" style={{ color: "#9ba5b2" }}>{item.label}</span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
