"use client";

import { useEffect, useRef, useState } from "react";
import { FiHelpCircle, FiX } from "react-icons/fi";
import type { RawCandle } from "../api/market/route";
import type { Level, TradeSetup, BreakoutEvent } from "../lib/analysis";

// ─── Quantz Palette ──────────────────────────────────────────────────────────
const P = {
  bg:        "#050816",
  bgLabel:   "#0b1428",
  grid:      "#0a1020",
  text:      "#2a4060",

  // Bullish alien green / Bearish dark slate
  upBody:    "#3dc85c",
  upBorder:  "#3dc85c",
  upWick:    "#3dc85c",
  downBody:  "#e05252",
  downBorder:"#e05252",
  downWick:  "#e05252",

  crosshair: "rgba(155,126,232,0.25)",

  // Analysis lines at 0.7 opacity — visible but never in the way of the tape
  resistance: "rgba(224,82,82,0.7)",
  support:    "rgba(61,200,92,0.7)",

  entry: "rgba(155,126,232,0.75)",
  sl:    "rgba(224,82,82,0.7)",
  tp:    "rgba(61,200,92,0.85)",
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
  tdSymbol: string;
  yahooTickFallback?: boolean;
  onTick?: (price: number) => void;
}

const LEGEND = [
  { color: P.upBorder,    label: "Vela alcista", style: "solid" },
  { color: P.downBorder,  label: "Vela bajista", style: "solid" },
  { color: "rgba(155,126,232,0.6)", label: "MA 20 (tendencia)", style: "solid" },
  { color: P.resistance,  label: "Resistencia",     style: "solid" },
  { color: P.support,     label: "Soporte",        style: "solid" },
  { color: P.entry,       label: "Entrada",          style: "dashed" },
  { color: P.sl,          label: "Stop Loss",      style: "solid" },
  { color: P.tp,          label: "Take Profit",    style: "solid" },
];

export default function AxeChart({ candles, levels, ma20, tradeSetup, breakout, accentColor = "#9b7ee8", symbol, tdSymbol, yahooTickFallback = true, onTick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef  = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<any>(null);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [showLegend, setShowLegend] = useState(false);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  // ── Main chart init ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let chart: any = null;

    async function init() {
      const LW = await import("lightweight-charts");

      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }

      const el = containerRef.current!;
      chart = LW.createChart(el, {
        width:  el.clientWidth,
        height: el.clientHeight,
        layout: {
          background: { type: LW.ColorType.Solid, color: P.bg },
          textColor: P.text,
          fontSize: 12,
        },
        grid: {
          vertLines: { color: P.grid },
          horzLines: { color: P.grid },
        },
        crosshair: {
          mode: LW.CrosshairMode.Normal,
          vertLine: { color: P.crosshair, labelBackgroundColor: P.bgLabel, width: 1, style: LW.LineStyle.Dashed },
          horzLine: { color: P.crosshair, labelBackgroundColor: P.bgLabel, width: 1, style: LW.LineStyle.Dashed },
        },
        rightPriceScale: { borderColor: P.grid, scaleMargins: { top: 0.1, bottom: 0.1 } },
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

      // Candles
      seriesRef.current = null;
      const cs = chart.addSeries(LW.CandlestickSeries, {
        upColor:        P.upBody,
        downColor:      P.downBody,
        borderUpColor:  P.upBorder,
        borderDownColor:P.downBorder,
        wickUpColor:    P.upWick,
        wickDownColor:  P.downWick,
      });

      const seen = new Set<number>();
      const clean = candles
        .filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true; })
        .sort((a, b) => a.time - b.time)
        .map(c => ({ time: c.time as number, open: c.open, high: c.high, low: c.low, close: c.close }));

      cs.setData(clean);
      seriesRef.current = cs;

      // MA20
      if (ma20 > 0 && clean.length >= 20) {
        const maSeries = chart.addSeries(LW.LineSeries, {
          color: accentColor + "55",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        const maData: { time: number; value: number }[] = [];
        for (let i = 19; i < clean.length; i++) {
          const avg = clean.slice(i - 19, i + 1).reduce((s, c) => s + c.close, 0) / 20;
          maData.push({ time: clean[i].time, value: avg });
        }
        maSeries.setData(maData);
      }

      // ── Levels & setup — deduplicated so labels never stack ──────────
      const currentPrice = clean[clean.length - 1]?.close ?? 0;
      const eps = currentPrice * 0.0006; // prices closer than this are "the same line"
      const near = (a: number, b: number) => Math.abs(a - b) < eps;

      const entryIsBrokenLevel = !!(tradeSetup && breakout && near(tradeSetup.entryPrice, breakout.level));

      // Prices already covered by setup/breakout lines — S/R there would be a duplicate
      const taken: number[] = [];
      if (tradeSetup) taken.push(tradeSetup.entryPrice, tradeSetup.stopLoss, tradeSetup.takeProfit);
      if (breakout) taken.push(breakout.level);

      const topR = levels
        .filter(l => l.type === "resistance" && l.price > currentPrice && !taken.some(p => near(p, l.price)))
        .sort((a, b) => b.strength - a.strength)[0];
      const topS = levels
        .filter(l => l.type === "support" && l.price < currentPrice && !taken.some(p => near(p, l.price)))
        .sort((a, b) => b.strength - a.strength)[0];

      if (topR) {
        cs.createPriceLine({
          price: topR.price,
          color: P.resistance,
          lineWidth: 2,
          lineStyle: LW.LineStyle.Solid,
          axisLabelVisible: true,
          title: `RESISTANCE  (${topR.strength}x)`,
        });
      }
      if (topS) {
        cs.createPriceLine({
          price: topS.price,
          color: P.support,
          lineWidth: 2,
          lineStyle: LW.LineStyle.Solid,
          axisLabelVisible: true,
          title: `SUPPORT  (${topS.strength}x)`,
        });
      }

      // ── Trade setup ───────────────────────────────────────────────────
      if (tradeSetup) {
        cs.createPriceLine({
          price: tradeSetup.entryPrice,
          color: P.entry,
          lineWidth: 3,
          lineStyle: LW.LineStyle.Dashed,
          axisLabelVisible: true,
          title: entryIsBrokenLevel
            ? `ENTRY ${tradeSetup.direction === "long" ? "▲ LONG" : "▼ SHORT"} · BROKEN LEVEL — WAIT RETEST`
            : `ENTRY  ${tradeSetup.direction === "long" ? "▲ LONG" : "▼ SHORT"}`,
        });
        cs.createPriceLine({
          price: tradeSetup.stopLoss,
          color: P.sl,
          lineWidth: 3,
          lineStyle: LW.LineStyle.Solid,
          axisLabelVisible: true,
          title: `STOP LOSS  −$100`,
        });
        cs.createPriceLine({
          price: tradeSetup.takeProfit,
          color: P.tp,
          lineWidth: 3,
          lineStyle: LW.LineStyle.Solid,
          axisLabelVisible: true,
          title: `TAKE PROFIT  +$${tradeSetup.rewardAmount}  (${tradeSetup.rrRatio}R)`,
        });
      }

      // ── Breakout level (own line only if the entry doesn't already mark it) ──
      if (breakout) {
        const bColor = breakout.direction === "long" ? "rgba(61,200,92,0.7)" : "rgba(224,82,82,0.7)";
        const bZone  = breakout.direction === "long" ? "rgba(61,200,92,0.22)" : "rgba(224,82,82,0.22)";
        if (!entryIsBrokenLevel) {
          cs.createPriceLine({
            price: breakout.level,
            color: bColor,
            lineWidth: 2,
            lineStyle: LW.LineStyle.Dashed,
            axisLabelVisible: true,
            title: `▶ BROKEN LEVEL  (${breakout.direction === "long" ? "LONG" : "SHORT"})  — WAIT RETEST`,
          });
        }
        // Retest zone boundaries (subtle dotted lines, no labels)
        cs.createPriceLine({ price: breakout.level + breakout.retestZone, color: bZone, lineWidth: 1, lineStyle: LW.LineStyle.Dotted, axisLabelVisible: false, title: "" });
        cs.createPriceLine({ price: breakout.level - breakout.retestZone, color: bZone, lineWidth: 1, lineStyle: LW.LineStyle.Dotted, axisLabelVisible: false, title: "" });
      }

      // Show last 4 hours of candles (240 bars for 1m, less for 5m)
      const barsToShow = 240;
      if (clean.length > barsToShow) {
        chart.timeScale().setVisibleLogicalRange({ from: clean.length - barsToShow, to: clean.length + 8 });
      } else {
        chart.timeScale().fitContent();
      }

      const ro = new ResizeObserver(() => {
        if (el && chart) chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
      });
      ro.observe(el);
      return () => ro.disconnect();
    }

    let cleanup: (() => void) | undefined;
    init().then(fn => { cleanup = fn; });

    return () => {
      cleanup?.();
      seriesRef.current = null;
      if (chart) { chart.remove(); chartRef.current = null; }
    };
  }, [candles, levels, ma20, tradeSetup, breakout, accentColor]);

  // ── Live data ────────────────────────────────────────────────────────────
  // Twelve Data WebSocket for all assets (indices, commodities, 24/5 real-time)
  useEffect(() => {
    if (!symbol) return;

    let disposed = false;
    let cur: { time: number; open: number; high: number; low: number; close: number } | null = null;

    const applyTick = (price: number, tsSec: number) => {
      if (!seriesRef.current || !isFinite(price)) return;
      const bucket = Math.floor(tsSec / 60) * 60;
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

    if (TD_API_KEY && tdSymbol) {
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

    return () => {
      disposed = true;
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatId) clearInterval(heartbeatId);
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tdSymbol]);

  return (
    <div className="relative w-full h-full" style={{ background: P.bg }}>
      <div ref={containerRef} className="w-full h-full" />

      {/* Live price badge */}
      {livePrice !== null && (
        <div
          className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded"
          style={{ background: "rgba(8,13,26,0.92)", border: "1px solid rgba(155,126,232,0.35)" }}
        >
          <span className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ background: "#9b7ee8" }} />
          <span className="font-bold text-sm tracking-wide" style={{ color: "#9b7ee8", fontFamily: "var(--font-display)" }}>
            LIVE &nbsp;{livePrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      )}

      {/* Legend toggle */}
      <button
        onClick={() => setShowLegend(v => !v)}
        className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold tracking-wider"
        style={{ background: "rgba(8,13,26,0.92)", border: "1px solid rgba(155,126,232,0.25)", color: "#9b7ee8", cursor: "pointer" }}
      >
        {showLegend ? <FiX size={13} /> : <FiHelpCircle size={13} />} LEYENDA
      </button>

      {/* Legend panel */}
      {showLegend && (
        <div
          className="absolute top-12 right-3 rounded p-4 flex flex-col gap-3"
          style={{ background: "rgba(8,13,26,0.97)", border: "1px solid rgba(155,126,232,0.28)", minWidth: 210 }}
        >
          <div className="text-xs font-bold tracking-widest mb-1" style={{ color: "#9b7ee8" }}>QUÉ SIGNIFICA CADA LÍNEA</div>
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
              <span className="text-xs" style={{ color: "#b0c8e8" }}>{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
