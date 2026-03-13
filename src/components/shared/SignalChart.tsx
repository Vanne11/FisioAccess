import { useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface DataPoint {
  timestamp_ms: number;
  value: number;
}

interface SignalChartProps {
  data: DataPoint[];
  color?: string;
  height?: number;
  label?: string;
  yUnit?: string;
  className?: string;
}

function niceSteps(min: number, max: number, count: number) {
  const range = max - min || 1;
  const rough = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = mag * ([1, 2, 5, 10].find((c) => c * mag >= rough) ?? 10);
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.01; v += step) ticks.push(v);
  return { ticks, step };
}

function formatTime(ms: number): string {
  if (Math.abs(ms) >= 10_000) return (ms / 1000).toFixed(1) + "s";
  if (Math.abs(ms) >= 1_000) return (ms / 1000).toFixed(2) + "s";
  return ms.toFixed(0) + "ms";
}

function decimalsFor(step: number): number {
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  if (step >= 0.01) return 2;
  return 3;
}

export function SignalChart({
  data,
  color = "#3b82f6",
  height = 280,
  label,
  yUnit = "",
  className,
}: SignalChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setCw(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (data.length === 0 || cw === 0) {
    return (
      <div
        ref={containerRef}
        className={cn(
          "signal-grid w-full flex items-center justify-center text-muted rounded-lg",
          className,
        )}
        style={{ height }}
      >
        {cw === 0 ? null : (label ?? "Sin datos")}
      </div>
    );
  }

  // Márgenes px
  const ML = 52;
  const MR = 8;
  const MT = 18;
  const MB = 24;
  const pw = cw - ML - MR;
  const ph = height - MT - MB;

  // Rangos
  const vals = data.map((d) => d.value);
  const vMin = Math.min(...vals);
  const vMax = Math.max(...vals);
  const vr = vMax - vMin || 1;
  const pad = vr * 0.1;
  const yLo = vMin - pad;
  const yHi = vMax + pad;
  const yr = yHi - yLo;

  const t0 = data[0].timestamp_ms;
  const t1 = data[data.length - 1].timestamp_ms;
  const tr = t1 - t0 || 1;

  const tx = (ms: number) => ML + ((ms - t0) / tr) * pw;
  const ty = (v: number) => MT + ph - ((v - yLo) / yr) * ph;

  const pts = data.map((d) => `${tx(d.timestamp_ms)},${ty(d.value)}`).join(" ");

  const { ticks: yt, step: ys } = niceSteps(yLo, yHi, 5);
  const yd = decimalsFor(ys);
  const { ticks: xt } = niceSteps(t0, t1, Math.max(3, Math.floor(pw / 130)));

  const labelColor = "rgba(255,255,255,0.65)";
  const gridColor = "rgba(255,255,255,0.07)";

  return (
    <div
      ref={containerRef}
      className={cn("signal-grid w-full rounded-lg overflow-hidden relative", className)}
      style={{ height }}
    >
      {/* Labels Y — HTML para evitar distorsión SVG */}
      {yt.map((val) => {
        const y = ty(val);
        if (y < MT - 4 || y > MT + ph + 4) return null;
        return (
          <span
            key={`yl-${val}`}
            className="absolute text-[10px] font-mono leading-none text-right pointer-events-none select-none"
            style={{
              right: cw - ML + 5,
              top: y - 5,
              color: labelColor,
            }}
          >
            {val.toFixed(yd)}
          </span>
        );
      })}

      {/* Labels X — HTML */}
      {xt.map((ms) => {
        const x = tx(ms);
        if (x < ML - 5 || x > ML + pw + 5) return null;
        return (
          <span
            key={`xl-${ms}`}
            className="absolute text-[10px] font-mono leading-none pointer-events-none select-none"
            style={{
              left: x,
              bottom: 2,
              transform: "translateX(-50%)",
              color: labelColor,
            }}
          >
            {formatTime(ms - t0)}
          </span>
        );
      })}

      {/* Unidad Y */}
      {yUnit && (
        <span
          className="absolute text-[10px] font-mono pointer-events-none select-none"
          style={{ left: 2, top: 2, color: labelColor }}
        >
          {yUnit}
        </span>
      )}

      {/* SVG: solo grid + señal */}
      <svg
        width={cw}
        height={height}
        viewBox={`0 0 ${cw} ${height}`}
        style={{ display: "block" }}
      >
        {/* Grid horizontal */}
        {yt.map((val) => {
          const y = ty(val);
          if (y < MT - 2 || y > MT + ph + 2) return null;
          return (
            <line key={`yg-${val}`} x1={ML} y1={y} x2={ML + pw} y2={y} stroke={gridColor} strokeWidth="1" />
          );
        })}

        {/* Grid vertical */}
        {xt.map((ms) => {
          const x = tx(ms);
          if (x < ML - 2 || x > ML + pw + 2) return null;
          return (
            <line key={`xg-${ms}`} x1={x} y1={MT} x2={x} y2={MT + ph} stroke={gridColor} strokeWidth="1" />
          );
        })}

        {/* Línea base 0 */}
        {yLo <= 0 && yHi >= 0 && (
          <line
            x1={ML} y1={ty(0)} x2={ML + pw} y2={ty(0)}
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="1"
            strokeDasharray="4,3"
          />
        )}

        {/* Clip */}
        <defs>
          <clipPath id="sc-clip">
            <rect x={ML} y={MT} width={pw} height={ph} />
          </clipPath>
        </defs>

        <g clipPath="url(#sc-clip)">
          <polyline points={pts} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" opacity="0.15" />
          <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>

        {/* Borde plot */}
        <rect x={ML} y={MT} width={pw} height={ph} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
      </svg>
    </div>
  );
}
