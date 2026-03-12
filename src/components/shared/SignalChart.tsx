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
  className?: string;
}

export function SignalChart({
  data,
  color = "#3b82f6",
  height = 280,
  label,
  className,
}: SignalChartProps) {
  if (data.length === 0) {
    return (
      <div
        className={cn(
          "signal-grid w-full flex items-center justify-center text-muted rounded-lg",
          className,
        )}
        style={{ height }}
      >
        {label ?? "Sin datos"}
      </div>
    );
  }

  const values = data.map((d) => d.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;
  const padding = range * 0.1;
  const adjMin = minVal - padding;
  const adjRange = range + padding * 2;

  const w = 1000;
  const h = 400;

  const points = data
    .map((d, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((d.value - adjMin) / adjRange) * h;
      return `${x},${y}`;
    })
    .join(" ");

  // Y-axis labels
  const ySteps = 5;
  const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => {
    const val = adjMin + (adjRange / ySteps) * i;
    return { val, y: h - (i / ySteps) * h };
  });

  return (
    <div
      className={cn("signal-grid w-full rounded-lg overflow-hidden", className)}
      style={{ height }}
    >
      <svg
        viewBox={`-50 -10 ${w + 60} ${h + 20}`}
        preserveAspectRatio="none"
        className="w-full h-full"
      >
        {/* Y-axis grid lines */}
        {yLabels.map(({ val, y }) => (
          <g key={val}>
            <line
              x1={0}
              y1={y}
              x2={w}
              y2={y}
              stroke="rgba(255,255,255,0.04)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={-8}
              y={y + 3}
              fill="rgba(255,255,255,0.2)"
              fontSize="24"
              textAnchor="end"
              style={{ fontFamily: "monospace" }}
            >
              {val.toFixed(0)}
            </text>
          </g>
        ))}

        {/* Signal line */}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Glow effect */}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          opacity="0.15"
        />
      </svg>
    </div>
  );
}
