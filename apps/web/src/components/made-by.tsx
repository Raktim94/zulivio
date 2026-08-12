import clsx from "clsx";

export function MadeBy({ className, onDark = false }: { className?: string; onDark?: boolean }) {
  return (
    <p className={clsx("text-[11px]", onDark ? "text-white/40" : "text-muted", className)}>
      Zulivio · made by{" "}
      <a
        href="https://www.nodedr.com/"
        target="_blank"
        rel="noreferrer"
        className={clsx(
          "underline",
          onDark
            ? "decoration-white/20 hover:text-white/70 hover:decoration-white/40"
            : "decoration-border hover:text-ink",
        )}
      >
        NodeDR Infotech Private Limited
      </a>
    </p>
  );
}
