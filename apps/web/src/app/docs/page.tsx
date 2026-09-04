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
          <div className="flex items-center gap-4">
            <Link href="/demo" className="text-sm font-medium text-muted hover:text-ink transition-colors">
              Demo
            </Link>
            <Link href="/login" className="text-sm font-medium text-emerald-dark">
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-12 px-4 py-12">
        {/* Hero Section */}
        <section className="text-center">
          <h1 className="text-3xl font-bold text-ink">Zulivio Documentation</h1>
          <p className="mt-3 text-base text-muted">
            Open-source, self-hostable workforce-operations CRM. This page is public — no sign-in
            required — for anyone evaluating Zulivio or connecting an AI assistant to an existing instance.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <a
              href="https://github.com/Raktim94/zulivio"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink transition-all hover:bg-canvas"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              GitHub
            </a>
            <a
              href="https://apps.microsoft.com/store/detail/9NZ9JZN31RN0?cid=DevShareMCLPCS"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-[#0078D4] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#006CBE]"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
              </svg>
              Microsoft Store
            </a>
          </div>
        </section>

        {/* User Manual */}
        <section>
          <h2 className="text-xl font-semibold text-ink">User manual</h2>
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

        {/* MCP Section - Enhanced */}
        <section>
          <div className="mb-6 flex items-center gap-3">
            <h2 className="text-xl font-semibold text-ink">MCP Server</h2>
            <span className="inline-flex items-center rounded-full bg-indigo/10 px-2.5 py-0.5 text-xs font-medium text-indigo">
              AI Integration
            </span>
          </div>

          {/* What is MCP */}
          <Card className="mb-6">
            <h3 className="mb-2 text-sm font-semibold text-ink">What is MCP?</h3>
            <p className="text-sm text-muted">
              The{" "}
              <a
                href="https://modelcontextprotocol.io"
                target="_blank"
                rel="noreferrer"
                className="text-emerald-dark underline"
              >
                Model Context Protocol
              </a>{" "}
              is an open standard that lets AI assistants connect to external data sources and tools
              in a secure, standardized way. Think of it as a universal adapter between your AI and your
              business tools. Zulivio implements the MCP Streamable HTTP transport, making it compatible
              with all major AI platforms.
            </p>
          </Card>

          {/* Design Philosophy */}
          <Card className="mb-6">
            <h3 className="mb-3 text-sm font-semibold text-ink">Design Philosophy</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-canvas p-3">
                <p className="text-xs font-medium text-emerald-dark">Zero-Trust Security</p>
                <p className="mt-1 text-xs text-muted">Every MCP call goes through the same RBAC/scope checks as the REST API</p>
              </div>
              <div className="rounded-lg bg-canvas p-3">
                <p className="text-xs font-medium text-emerald-dark">Curated Tool Surface</p>
                <p className="mt-1 text-xs text-muted">Only safe, read-heavy operations are exposed; no destructive actions</p>
              </div>
              <div className="rounded-lg bg-canvas p-3">
                <p className="text-xs font-medium text-emerald-dark">Personal API Keys</p>
                <p className="mt-1 text-xs text-muted">Each key resolves to the employee who created it, carrying their permissions</p>
              </div>
              <div className="rounded-lg bg-canvas p-3">
                <p className="text-xs font-medium text-emerald-dark">No Synthetic Permissions</p>
                <p className="mt-1 text-xs text-muted">The AI can only do what the employee could already do in the app</p>
              </div>
            </div>
          </Card>

          {/* Architecture */}
          <Card className="mb-6">
            <h3 className="mb-3 text-sm font-semibold text-ink">Architecture</h3>
            <pre className="overflow-x-auto rounded-md bg-canvas p-3 text-xs text-ink">
{`AI Assistant (Claude/ChatGPT/etc.)
        │
        ▼
  MCP Client (Streamable HTTP)
        │
        ▼
  Zulivio MCP Endpoint (/api/v1/mcp)
        │
        ├── AuthGuard (API key → employee lookup)
        ├── RBAC Guard (role hierarchy enforcement)
        ├── Scope Guard (org-scoped data access)
        │
        ▼
  NestJS Service Layer (same as REST API)
        │
        ▼
  Prisma → PostgreSQL`}
            </pre>
          </Card>

          {/* Connection Setup */}
          <Card className="mb-6">
            <h3 className="mb-2 text-sm font-semibold text-ink">Endpoint</h3>
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

          {/* Client Setup */}
          <Card className="mb-6">
            <h3 className="mb-3 text-sm font-semibold text-ink">Connect Your AI Client</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="pb-2 font-medium text-muted">Platform</th>
                    <th className="pb-2 font-medium text-muted">Setup</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border">
                    <td className="py-2 font-medium text-ink">Claude.ai</td>
                    <td className="py-2 text-muted">Add connector → paste endpoint URL → set Authorization header</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-2 font-medium text-ink">ChatGPT</td>
                    <td className="py-2 text-muted">Add connector → paste endpoint URL → set Authorization header</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-2 font-medium text-ink">Claude Desktop</td>
                    <td className="py-2 text-muted">Use mcp-remote proxy (see config in README)</td>
                  </tr>
                  <tr>
                    <td className="py-2 font-medium text-ink">Other MCP clients</td>
                    <td className="py-2 text-muted">Endpoint: /api/v1/mcp with Bearer auth</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          {/* Tools Table */}
          <h3 className="mb-3 text-sm font-semibold text-ink">Available Tools</h3>
          <div className="overflow-x-auto rounded-xl border border-border">
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
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        tool.type === "Read" ? "bg-emerald/10 text-emerald-dark" : "bg-amber/10 text-amber"
                      }`}>
                        {tool.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted">{tool.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Security */}
          <Card className="mt-6">
            <h3 className="mb-2 text-sm font-semibold text-ink">Security</h3>
            <ul className="list-inside list-disc space-y-1 text-sm text-muted">
              <li>API keys are personal — they resolve to the employee who created them</li>
              <li>All RBAC, scope, and state machine checks apply identically to MCP calls</li>
              <li>No destructive operations (delete, role changes, backup restore) are exposed</li>
              <li>Keys can be revoked instantly from Settings → API Keys</li>
            </ul>
          </Card>

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

        {/* Quick Links */}
        <section>
          <h2 className="text-xl font-semibold text-ink">Quick links</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Link href="/login" className="rounded-xl border border-border bg-surface p-4 transition-all hover:bg-canvas">
              <p className="font-medium text-ink">Sign in to your instance</p>
              <p className="mt-1 text-xs text-muted">Access your workforce dashboard</p>
            </Link>
            <Link href="/setup" className="rounded-xl border border-border bg-surface p-4 transition-all hover:bg-canvas">
              <p className="font-medium text-ink">Set up a new organization</p>
              <p className="mt-1 text-xs text-muted">Create your company and first admin account</p>
            </Link>
            <a href="https://github.com/Raktim94/zulivio" target="_blank" rel="noreferrer" className="rounded-xl border border-border bg-surface p-4 transition-all hover:bg-canvas">
              <p className="font-medium text-ink">GitHub repository</p>
              <p className="mt-1 text-xs text-muted">Source code, issues, and contributing guide</p>
            </a>
            <a href="https://github.com/Raktim94/zulivio/blob/main/ROADMAP.md" target="_blank" rel="noreferrer" className="rounded-xl border border-border bg-surface p-4 transition-all hover:bg-canvas">
              <p className="font-medium text-ink">Product roadmap</p>
              <p className="mt-1 text-xs text-muted">15-18 month implementation plan</p>
            </a>
          </div>
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
