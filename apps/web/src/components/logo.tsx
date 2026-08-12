import Image from "next/image";
import clsx from "clsx";

const SIZES = { sm: 28, md: 40, lg: 88 } as const;

/**
 * The Zulivio badge (assets/logo.png) already bakes in the "ZULIVIO by
 * Nodedr" wordmark, so it's used standalone here rather than paired with a
 * separate text label — a second label would just repeat what the badge
 * already says.
 */
export function Logo({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const px = SIZES[size];

  return (
    <div className={clsx("flex items-center", className)}>
      <Image
        src="/logo.png"
        alt="Zulivio"
        width={px}
        height={px}
        priority={size === "lg"}
      />
    </div>
  );
}
