import type { Metadata } from "next";
import { QueryProvider } from "@/lib/query-provider";
import { ToastProvider } from "@/components/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zulivio",
  description: "Open-source CRM and humane workforce-operations platform",
};

// Runs before paint to stamp the saved theme (or leave it unset for
// "system") on <html>, so there's no flash of the wrong theme on load.
const themeInitScript = `
(function () {
  try {
    var saved = localStorage.getItem("zulivio-theme");
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <QueryProvider>
          <ToastProvider>{children}</ToastProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
