import clsx from "clsx";

/**
 * Zulivio wordmark: a rounded-square emerald mark with a cut "Z" flag glyph,
 * built entirely in SVG/CSS — no image asset to keep in sync or ship.
 */
export function Logo({
  size = "md",
  onDark = false,
  className,
}: {
  size?: "sm" | "md" | "lg";
  onDark?: boolean;
  className?: string;
}) {
  const markSize = { sm: 24, md: 32, lg: 44 }[size];
  const textSize = { sm: "text-sm", md: "text-lg", lg: "text-2xl" }[size];

  return (
    <div className={clsx("flex items-center gap-2.5", className)}>
      <svg
        width={markSize}
        height={markSize}
        viewBox="0 0 32 32"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <rect width="32" height="32" rx="9" fill="#168B65" />
        <text
          x="16"
          y="22"
          textAnchor="middle"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontWeight="700"
          fontSize="17"
          fill="white"
        >
          Z
        </text>
      </svg>
      <span
        className={clsx(
          "font-semibold tracking-tight",
          textSize,
          onDark ? "text-white" : "text-ink",
        )}
      >
        Zulivio
      </span>
    </div>
  );
}
