"use client";

import { useEffect, useRef, useState } from "react";
import type { RawCandle } from "../api/market/route";
import type { Level, TradeSetup, BreakoutEvent } from "../lib/analysis";

// ─── Axe Capital Palette ─────────────────────────────────────────────────────
const P = {
  bg:        "#03030a",
  bgLabel:   "#0c0c1c",
  grid:      "#0b0b18",
  text:      "#3e3e58",

  // Solid MT-style bodies — high contrast, easy to read
  upBody:    "#00c870",
  upBorder:  "#00c870",
  upWick:    "#00c870",
  downBody:  "#f23645",
  downBorder:"#f23645",
  downWick:  "#f23645",

  crosshair: "rgba(212,175,55,0.22)",

  resistance: "rgba(230,55,55,1)",
  support:    "rgba(0,210,115,1)",

  entry: "#f0cc4a",
  sl:    "#ff3535",
  tp:    "#00e878",
};

// Retest zone: price within 0.18% of the broken level
const RETEST_THRESHOLD_PCT = 0.0018;

const TD_API_KEY = process.env.NEXT_PUBLIC_TWELVEDATA_API_KEY;

function playAlertSound() {
  try {
    const ctx = new AudioContext();
    [[440, 0], [554, 0.18], [659, 0.36], [880, 0.54]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + delay;
      gain.gain.setValueAtTime(0.0, t);
      gain.gain.linearRampToValueAtTime(0.35, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  } catch { /* audio not available */ }
}

interface Props {
  candles: RawCandle[];
  levels: Level[];
  ma20: number;
  tradeSetup: TradeSetup | null;
  breakout: BreakoutEvent | null;
  accentColor?: string;
  symbol: string;
  tdSymbol: string;
}

const LEGEND = [
  { color: P.upBorder,    label: "Vela sube",     style: "solid" },
  { color: P.downBorder,  label: "Vela baja",     style: "solid" },
  { color: "rgba(212,175,55,0.6)", label: "MA 20 (tendencia)", style: "solid" },
  { color: P.resistance,  label: "Resistencia",   style: "solid" },
  { color: P.support,     label: "Soporte",       style: "solid" },
  { color: P.entry,       label: "Entrada",       style: "dashed" },
  { color: P.sl,          label: "Stop Loss",     style: "solid" },
  { color: P.tp,          label: "Take Profit",   style: "solid" },
];

export default function AxeChart({ candles, levels, ma20, tradeSetup, breakout, accentColor = "#d4af37", symbol, tdSymbol }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef  = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<any>(null);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [showLegend, setShowLegend] = useState(false);
  const [retestActive, setRetestActive] = useState(false);
  const inRetestZoneRef = useRef(false);
  const retestDismissedRef = useRef(false);

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

      // ── Only the single strongest R above + single strongest S below ──
      const currentPrice = clean[clean.length - 1]?.close ?? 0;
      const topR = levels
        .filter(l => l.type === "resistance" && l.price > currentPrice)
        .sort((a, b) => b.strength - a.strength)[0];
      const topS = levels
        .filter(l => l.type === "support" && l.price < currentPrice)
        .sort((a, b) => b.strength - a.strength)[0];

      if (topR) {
        cs.createPriceLine({
          price: topR.price,
          color: P.resistance,
          lineWidth: 2,
          lineStyle: LW.LineStyle.Solid,
          axisLabelVisible: true,
          title: `RESISTENCIA  (${topR.strength}x)`,
        });
      }
      if (topS) {
        cs.createPriceLine({
          price: topS.price,
          color: P.support,
          lineWidth: 2,
          lineStyle: LW.LineStyle.Solid,
          axisLabelVisible: true,
          title: `SOPORTE  (${topS.strength}x)`,
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
          title: `ENTRADA  ${tradeSetup.direction === "long" ? "▲ LONG" : "▼ SHORT"}`,
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

      // ── Breakout level ───────────────────────────────────────────────────
      if (breakout) {
        const bColor = breakout.direction === "long" ? "#ffe566" : "#ff6060";
        cs.createPriceLine({
          price: breakout.level,
          color: bColor,
          lineWidth: 2,
          lineStyle: LW.LineStyle.Dashed,
          axisLabelVisible: true,
          title: `▶ NIVEL ROTO  (${breakout.direction === "long" ? "LONG" : "SHORT"})  — ESPERA RETEST`,
        });
        const zone = breakout.level * RETEST_THRESHOLD_PCT;
        cs.createPriceLine({ price: breakout.level + zone, color: bColor + "44", lineWidth: 1, lineStyle: LW.LineStyle.Dotted, axisLabelVisible: false, title: "" });
        cs.createPriceLine({ price: breakout.level - zone, color: bColor + "44", lineWidth: 1, lineStyle: LW.LineStyle.Dotted, axisLabelVisible: false, title: "" });
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

  // Reset retest state when breakout changes (new analysis or market switch)
  useEffect(() => {
    setRetestActive(false);
    inRetestZoneRef.current = false;
    retestDismissedRef.current = false;
  }, [breakout]);

  // ── Live data ────────────────────────────────────────────────────────────
  // Primary: Twelve Data WebSocket (real-time streaming ticks).
  // Fallback: Yahoo polling every 1 s if the WS delivers nothing in 15 s.
  useEffect(() => {
    if (!symbol) return;

    const checkRetest = (price: number) => {
      if (!breakout || retestDismissedRef.current) return;
      const zone = breakout.level * RETEST_THRESHOLD_PCT;
      const isInZone = Math.abs(price - breakout.level) < zone;
      if (isInZone && !inRetestZoneRef.current) {
        inRetestZoneRef.current = true;
        setRetestActive(true);
        playAlertSound();
      } else if (!isInZone && inRetestZoneRef.current) {
        inRetestZoneRef.current = false;
      }
    };

    let disposed = false;
    let pollId: ReturnType<typeof setInterval> | null = null;

    // In-progress 1m candle built from streaming ticks
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
      try { seriesRef.current.update({ ...cur }); } catch { /* out-of-order tick */ }
      setLivePrice(price);
      checkRetest(price);
    };

    // ── Yahoo polling (fallback) ────────────────────────────────────────
    const startPolling = () => {
      if (disposed || pollId) return;
      const tick = async () => {
        if (!seriesRef.current) return;
        try {
          const res = await fetch(`/api/tick?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
          if (!res.ok) return;
          const data = await res.json();
          if (!data.candle) return;
          try { seriesRef.current.update({ ...data.candle }); } catch { /* skip */ }
          cur = null; // yahoo owns the candle now
          setLivePrice(data.currentPrice);
          checkRetest(data.currentPrice);
        } catch { /* skip */ }
      };
      tick();
      pollId = setInterval(tick, 1000);
    };

    // ── Twelve Data WebSocket ───────────────────────────────────────────
    let ws: WebSocket | null = null;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatId: ReturnType<typeof setInterval> | null = null;
    let gotData = false;

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
              gotData = true;
              if (pollId) { clearInterval(pollId); pollId = null; } // WS took over
              applyTick(msg.price, msg.timestamp ?? Math.floor(Date.now() / 1000));
            }
          } catch { /* skip malformed */ }
        };
        ws.onclose = () => {
          if (heartbeatId) { clearInterval(heartbeatId); heartbeatId = null; }
          if (!closed) reconnectTimer = setTimeout(connect, 3000);
        };
        ws.onerror = () => { ws?.close(); };
      };
      connect();

      // If the WS gives nothing in 15 s (symbol not in plan, market closed), poll Yahoo
      setTimeout(() => { if (!gotData && !disposed) startPolling(); }, 15000);
    } else {
      startPolling();
    }

    return () => {
      disposed = true;
      closed = true;
      if (pollId) clearInterval(pollId);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatId) clearInterval(heartbeatId);
      ws?.close();
    };
  }, [symbol, tdSymbol, breakout]);

  return (
    <div className="relative w-full h-full" style={{ background: P.bg }}>
      <div ref={containerRef} className="w-full h-full" />

      {/* Live price badge */}
      {livePrice !== null && (
        <div
          className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded"
          style={{ background: "rgba(7,7,12,0.92)", border: "1px solid rgba(212,175,55,0.3)" }}
        >
          <span className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ background: "#d4af37" }} />
          <span className="font-bold text-sm tracking-wide" style={{ color: "#d4af37", fontFamily: "var(--font-display)" }}>
            LIVE &nbsp;{livePrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      )}

      {/* Retest alert overlay */}
      {retestActive && breakout && (
        <div
          className="absolute left-3 right-3 rounded-lg p-4 flex items-center justify-between"
          style={{
            top: livePrice ? "3.5rem" : "0.75rem",
            background: "rgba(7,7,12,0.97)",
            border: `2px solid ${breakout.direction === "long" ? "#ffe566" : "#ff6060"}`,
            boxShadow: `0 0 24px ${breakout.direction === "long" ? "rgba(255,229,102,0.4)" : "rgba(255,96,96,0.4)"}`,
          }}
        >
          <div>
            <div className="font-black text-lg tracking-wider" style={{ color: breakout.direction === "long" ? "#ffe566" : "#ff6060" }}>
              ⚡ RETEST ACTIVO — {breakout.level.toFixed(2)}
            </div>
            <div className="text-sm mt-0.5" style={{ color: "#c8c8d8" }}>
              {breakout.direction === "long" ? "▲ LONG" : "▼ SHORT"} · El nivel fue roto · Confirma la vela antes de entrar
            </div>
          </div>
          <button
            onClick={() => { setRetestActive(false); retestDismissedRef.current = true; }}
            className="ml-4 px-3 py-1.5 rounded text-xs font-bold flex-shrink-0"
            style={{ background: "rgba(255,255,255,0.08)", color: "#888", cursor: "pointer", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Legend toggle */}
      <button
        onClick={() => setShowLegend(v => !v)}
        className="absolute top-3 right-3 px-3 py-1.5 rounded text-xs font-bold tracking-wider"
        style={{ background: "rgba(7,7,12,0.92)", border: "1px solid rgba(212,175,55,0.2)", color: "#d4af37", cursor: "pointer" }}
      >
        {showLegend ? "✕ LEYENDA" : "? LEYENDA"}
      </button>

      {/* Legend panel */}
      {showLegend && (
        <div
          className="absolute top-12 right-3 rounded p-4 flex flex-col gap-3"
          style={{ background: "rgba(7,7,12,0.96)", border: "1px solid rgba(212,175,55,0.25)", minWidth: 210 }}
        >
          <div className="text-xs font-bold tracking-widest mb-1" style={{ color: "#d4af37" }}>QUÉ ES CADA LÍNEA</div>
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
              <span className="text-xs" style={{ color: "#c8c8d8" }}>{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
