import Link from "next/link";
import { Card } from "@/components/ui";
import { Logo } from "@/components/logo";
import { MadeBy } from "@/components/made-by";

const MCP_TOOLS: { name: string; type: "Read" | "Write"; note: string }[] = [
  { name: "list_employees", type: "Read", note: "Scoped by caller's role, same as the Employees page" },
  { name: "my_attendance_status", type: "Read", note: "logged_out / working / on_break" },
  { name: "start_attendance / end_attendance", type: "Write", note: "Clock in/out" },
  { name: "list_my_tasks", type: "Read", note: "Assignments owned by the caller" },
  { name: "update_task_status", type: "Write", note: "Same status state machine and ownership checks as the app" },
  { name: "list_leads", type: "Read", note: "Caller's own leads, or all if Manager+" },
  { name: "create_lead", type: "Write", note: "Optional autoAssign to run the org's assignment rule" },
  { name: "sales_dashboard", type: "Read", note: "Manager+ only, scoped to the caller's reporting subtree" },
];

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Logo size="sm" />
          <Link href="/login" className="text-sm font-medium text-emerald-dark">
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-12">
        <section>
          <h1 className="text-2xl font-semibold text-ink">Zulivio docs</h1>
          <p className="mt-2 text-sm text-muted">
            Open-source, self-hostable workforce-operations CRM. This page is public — no sign-in
            required — for anyone evaluating Zulivio or connecting an AI assistant to an existing instance.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">User manual</h2>
          <p className="mt-2 text-sm text-muted">
            A full step-by-step guide to every major action in the app — creating employees, running
            quality audits, connecting the MCP server below, and more — with real screenshots.
          </p>
          <a
            href="https://raw.githubusercontent.com/Raktim94/zulivio/main/docs/zulivio-user-manual.pdf"
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center rounded-lg bg-emerald px-4 py-2 text-sm font-medium text-white shadow-sm shadow-emerald/20 transition-all hover:bg-emerald-dark"
          >
            Download the PDF user manual
          </a>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">MCP server</h2>
          <p className="mt-2 text-sm text-muted">
            Zulivio exposes a{" "}
            <a
              href="https://modelcontextprotocol.io"
              target="_blank"
              rel="noreferrer"
              className="text-emerald-dark underline"
            >
              Model Context Protocol
            </a>{" "}
            server so an AI assistant (Claude, ChatGPT, or any other MCP-capable client) can act on your
            Zulivio account directly. Each connection is a personal API key generated from Settings → API
            Keys once signed in — a key carries no permissions of its own, it just resolves to the employee
            who created it, so the assistant can only ever do what that employee could already do in the
            app. The tool list is a deliberately curated subset of the API: nothing destructive (no
            deleting employees, no role changes, no backup restore) is reachable this way.
          </p>

          <Card className="mt-4">
            <p className="mb-2 text-xs font-medium text-muted">Endpoint</p>
            <code className="block break-all rounded-md bg-canvas px-3 py-2 text-xs text-ink">
              https://&lt;your-zulivio-domain&gt;/api/v1/mcp
            </code>
            <p className="mb-2 mt-4 text-xs font-medium text-muted">Test the connection</p>
            <pre className="overflow-x-auto rounded-md bg-canvas p-3 text-xs text-ink">
{`curl -X POST https://<your-zulivio-domain>/api/v1/mcp \\
  -H "Authorization: Bearer <your-api-key>" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`}
            </pre>
          </Card>

          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-canvas/60 text-left">
                  <th className="px-3 py-2 font-medium text-muted">Tool</th>
                  <th className="px-3 py-2 font-medium text-muted">Type</th>
                  <th className="px-3 py-2 font-medium text-muted">Notes</th>
                </tr>
              </thead>
              <tbody>
                {MCP_TOOLS.map((tool) => (
                  <tr key={tool.name} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink">{tool.name}</td>
                    <td className="px-3 py-2 text-ink">{tool.type}</td>
                    <td className="px-3 py-2 text-muted">{tool.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-sm text-muted">
            Full setup instructions for Claude Desktop, Claude.ai, and ChatGPT connectors are in the{" "}
            <a
              href="https://github.com/Raktim94/zulivio#mcp-server"
              target="_blank"
              rel="noreferrer"
              className="text-emerald-dark underline"
            >
              README&apos;s &quot;MCP server&quot; section
            </a>
            .
          </p>
        </section>
      </main>

      <footer className="border-t border-border px-4 py-6">
        <div className="mx-auto max-w-3xl">
          <MadeBy />
        </div>
      </footer>
    </div>
  );
}
