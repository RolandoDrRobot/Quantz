"use client";

import { useEffect, useRef, useState } from "react";
import { FiHelpCircle, FiX } from "react-icons/fi";
import type { RawCandle } from "../api/market/route";
import type { Level, TradeSetup, BreakoutEvent } from "../lib/analysis";

// ─── Quantz Palette ──────────────────────────────────────────────────────────
const P = {
  bg:        "#030405",
  bgLabel:   "#0c0e12",
  grid:      "#0a0c10",
  text:      "#565d66",

  upBody:    "#1c8f54",
  upBorder:  "#1c8f54",
  upWick:    "#1c8f54",
  downBody:  "#c24545",
  downBorder:"#c24545",
  downWick:  "#c24545",

  crosshair: "rgba(168,134,47,0.22)",

  // Analysis lines at 0.7 opacity — visible but never in the way of the tape
  resistance: "rgba(190,55,55,0.7)",
  support:    "rgba(0,165,95,0.7)",

  entry: "rgba(212,184,58,0.7)",
  sl:    "rgba(194,48,48,0.7)",
  tp:    "rgba(31,157,92,0.7)",
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
  binanceSymbol?: string | null;
  onTick?: (price: number) => void;
}

const LEGEND = [
  { color: P.upBorder,    label: "Vela alcista", style: "solid" },
  { color: P.downBorder,  label: "Vela bajista", style: "solid" },
  { color: "rgba(168,134,47,0.6)", label: "MA 20 (tendencia)", style: "solid" },
  { color: "rgba(28,143,84,0.55)", label: "Volumen (si el instrumento lo reporta)", style: "solid" },
  { color: P.resistance,  label: "Resistencia",     style: "solid" },
  { color: P.support,     label: "Soporte",        style: "solid" },
  { color: P.entry,       label: "Entrada",          style: "dashed" },
  { color: P.sl,          label: "Stop Loss",      style: "solid" },
  { color: P.tp,          label: "Take Profit",    style: "solid" },
];

export default function AxeChart({ candles, levels, ma20, tradeSetup, breakout, accentColor = "#a8862f", symbol, tdSymbol, binanceSymbol, onTick }: Props) {
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
  const prevCandlesRef = useRef<RawCandle[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roRef = useRef<any>(null);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [showLegend, setShowLegend] = useState(false);
  const onTickRef = useRef(onTick);
  const candlesRef = useRef(candles);
  useEffect(() => { onTickRef.current = onTick; }, [onTick]);
  useEffect(() => { candlesRef.current = candles; }, [candles]);

  // ── Single effect: rebuilds chart only when candles change; overlays always ─
  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let chart: any = null;
    let cancelled = false;
    const needRebuild = candles !== prevCandlesRef.current || !chartRef.current;

    async function run() {
      const LW = await import("lightweight-charts");

      // The effect can re-fire (fast market switching, a new candles prop
      // arriving) while the dynamic import above is still in flight. Without
      // this check a stale run would resume afterward, remove the chart the
      // newer run already built, and overwrite chartRef.current with its own
      // stale candles — silently reverting the UI to outdated data.
      if (cancelled) return;

      // The container can unmount while the dynamic import above is in
      // flight (fast market switching, Fast Refresh) — bail rather than
      // dereference a null ref.
      const el = containerRef.current;
      if (!el) return;

      // ── Rebuild chart + candle series only when candles actually changed ──
      if (needRebuild) {
        prevCandlesRef.current = candles;
        if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
        priceLinesRef.current = [];
        maSeriesRef.current = null;
        seriesRef.current = null;
        volSeriesRef.current = null;

        chart = LW.createChart(el, {
          width:  el.clientWidth,
          height: el.clientHeight,
          layout: { background: { type: LW.ColorType.Solid, color: P.bg }, textColor: P.text, fontSize: 12 },
          grid: { vertLines: { color: P.grid }, horzLines: { color: P.grid } },
          crosshair: {
            mode: LW.CrosshairMode.Normal,
            vertLine: { color: P.crosshair, labelBackgroundColor: P.bgLabel, width: 1, style: LW.LineStyle.Dashed },
            horzLine: { color: P.crosshair, labelBackgroundColor: P.bgLabel, width: 1, style: LW.LineStyle.Dashed },
          },
          // Bottom margin reserves room for the volume histogram, which
          // overlays this same pane on its own (bottom-anchored) price scale.
          rightPriceScale: { borderColor: P.grid, scaleMargins: { top: 0.1, bottom: 0.24 } },
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

        // Twelve Data's forex/crypto feed (Gold, Bitcoin) never reports
        // volume — skip the histogram entirely rather than draw a flat,
        // meaningless zero pane for those instruments.
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
              color: c.close >= c.open ? "rgba(28,143,84,0.55)" : "rgba(194,69,69,0.55)",
            }));
          vs.setData(volData);
          volSeriesRef.current = vs;
        }

        const barsToShow = 240;
        if (clean.length > barsToShow) {
          chart.timeScale().setVisibleLogicalRange({ from: clean.length - barsToShow, to: clean.length + 8 });
        } else {
          chart.timeScale().fitContent();
        }

        if (roRef.current) roRef.current.disconnect();
        roRef.current = new ResizeObserver(() => {
          if (el && chartRef.current) chartRef.current.applyOptions({ width: el.clientWidth, height: el.clientHeight });
        });
        roRef.current.observe(el);
      }

      // ── Always: refresh analysis overlay (price lines + MA) ───────────────
      const cs = seriesRef.current;
      const activeChart = chartRef.current;
      if (!cs || !activeChart) return;

      priceLinesRef.current.forEach(pl => { try { cs.removePriceLine(pl); } catch { /* ignore */ } });
      priceLinesRef.current = [];
      if (maSeriesRef.current) { try { activeChart.removeSeries(maSeriesRef.current); } catch { /* ignore */ } maSeriesRef.current = null; }

      if (ma20 > 0 && seriesRef.current) {
        // Compute MA from the current series data length via candles prop
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
          // this overlay effect re-runs on every phase transition, not just
          // on genuine candle-set changes, so O(n) matters on ~3000 candles.
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
        const bColor = breakout.direction === "long" ? "rgba(201,184,69,0.7)" : "rgba(214,72,72,0.7)";
        const bZone  = breakout.direction === "long" ? "rgba(201,184,69,0.25)" : "rgba(214,72,72,0.25)";
        if (!entryIsBrokenLevel) addLine({ price: breakout.level, color: bColor, lineWidth: 2, lineStyle: LW.LineStyle.Dashed, axisLabelVisible: true, title: breakout.direction === "long" ? "B▲" : "B▼" });
        addLine({ price: breakout.level + breakout.retestZone, color: bZone, lineWidth: 1, lineStyle: LW.LineStyle.Dotted, axisLabelVisible: false, title: "" });
        addLine({ price: breakout.level - breakout.retestZone, color: bZone, lineWidth: 1, lineStyle: LW.LineStyle.Dotted, axisLabelVisible: false, title: "" });
      }
    }

    let cleanup: (() => void) | undefined;
    run().then(fn => { cleanup = fn as (() => void) | undefined; });

    return () => {
      cancelled = true;
      cleanup?.();
      if (needRebuild) {
        roRef.current?.disconnect();
        roRef.current = null;
        seriesRef.current = null;
        maSeriesRef.current = null;
        priceLinesRef.current = [];
        if (chart) { chart.remove(); chartRef.current = null; }
      }
    };
  }, [candles, levels, ma20, tradeSetup, breakout, accentColor]);

  // ── Live data ────────────────────────────────────────────────────────────
  // Binance's public trade stream for Bitcoin; Twelve Data's WS for
  // everything else (indices, commodities, 24/5 real-time).
  useEffect(() => {
    if (!symbol) return;

    let cur: { time: number; open: number; high: number; low: number; close: number } | null = null;
    let curInterval = 0;

    const applyTick = (price: number, tsSec: number) => {
      if (!seriesRef.current || !isFinite(price)) return;
      // Match the bucket size to whatever interval the loaded candles actually
      // use (1m or 5m) instead of assuming 1m — a mismatch here is what makes
      // the live tick paint extra malformed bars between the real candles.
      const cds = candlesRef.current;
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

    if (binanceSymbol) {
      // Binance's public trade stream — free, no key, no subscribe handshake
      // or heartbeat needed (the browser answers WS ping frames natively).
      const streamSymbol = binanceSymbol.toLowerCase();
      const connect = () => {
        if (closed) return;
        ws = new WebSocket(`wss://stream.binance.com:9443/ws/${streamSymbol}@trade`);
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            const price = parseFloat(msg.p);
            if (isFinite(price)) {
              const tsSec = typeof msg.T === "number" ? Math.floor(msg.T / 1000) : Math.floor(Date.now() / 1000);
              applyTick(price, tsSec);
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

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatId) clearInterval(heartbeatId);
      ws?.close();
    };
  }, [symbol, tdSymbol, binanceSymbol]);

  return (
    <div className="relative w-full h-full" style={{ background: P.bg }}>
      <div ref={containerRef} className="w-full h-full" />

      {/* Live price badge */}
      {livePrice !== null && (
        <div
          className="absolute top-4 left-4 flex items-center gap-2 px-4 py-2 rounded-xl"
          style={{ background: "rgba(3,4,5,0.92)", border: "1px solid rgba(168,134,47,0.3)" }}
        >
          <span className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ background: "#a8862f" }} />
          <span className="font-bold text-sm tracking-wide" style={{ color: "#a8862f", fontFamily: "var(--font-display)" }}>
            LIVE &nbsp;{livePrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      )}

      {/* Legend toggle */}
      <button
        onClick={() => setShowLegend(v => !v)}
        className="absolute top-4 right-4 flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold tracking-wider"
        style={{ background: "rgba(3,4,5,0.92)", border: "1px solid rgba(168,134,47,0.2)", color: "#a8862f", cursor: "pointer" }}
      >
        {showLegend ? <FiX size={13} /> : <FiHelpCircle size={13} />} LEYENDA
      </button>

      {/* Legend panel */}
      {showLegend && (
        <div
          className="absolute top-14 right-4 rounded-xl p-5 flex flex-col gap-4"
          style={{ background: "rgba(3,4,5,0.96)", border: "1px solid rgba(168,134,47,0.25)", minWidth: 210 }}
        >
          <div className="text-xs font-bold tracking-widest mb-1" style={{ color: "#a8862f" }}>QUÉ SIGNIFICA CADA LÍNEA</div>
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
              <span className="text-xs" style={{ color: "#9aa1ab" }}>{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
