import Link from "next/link";
import VerticalBarsNoise from "@/components/ui/vertical-bars";
import { Logo } from "@/components/logo";

export default function DemoPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#F0EEE6]">
      <VerticalBarsNoise
        backgroundColor="#F0EEE6"
        lineColor="#444"
        barColor="#1a1a2e"
        lineWidth={1}
        animationSpeed={0.0005}
        removeWaveLine={true}
      />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-8 flex justify-center">
            <Logo size="lg" />
          </div>

          <h1 className="text-4xl font-bold tracking-tight text-[#1a1a2e] sm:text-5xl md:text-6xl">
            Zulivio
          </h1>
          <p className="mt-4 text-lg text-[#444] sm:text-xl">
            Open-source, self-hostable CRM and workforce-operations platform
          </p>

          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/setup"
              className="inline-flex items-center rounded-lg bg-[#10b981] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#10b981]/25 transition-all hover:bg-[#059669] hover:shadow-xl hover:shadow-[#10b981]/30"
            >
              Get Started
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center rounded-lg border border-[#1a1a2e]/20 bg-white/80 px-6 py-3 text-sm font-semibold text-[#1a1a2e] backdrop-blur-sm transition-all hover:bg-white hover:shadow-lg"
            >
              Sign In
            </Link>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div className="rounded-xl border border-[#1a1a2e]/10 bg-white/60 p-6 backdrop-blur-sm">
              <div className="mb-3 text-2xl">👥</div>
              <h3 className="font-semibold text-[#1a1a2e]">Employee Management</h3>
              <p className="mt-1 text-sm text-[#444]">
                Role-based access, auto-generated credentials, manager hierarchy
              </p>
            </div>
            <div className="rounded-xl border border-[#1a1a2e]/10 bg-white/60 p-6 backdrop-blur-sm">
              <div className="mb-3 text-2xl">📋</div>
              <h3 className="font-semibold text-[#1a1a2e]">Assignments</h3>
              <p className="mt-1 text-sm text-[#444]">
                Track work through state machines with full audit trails
              </p>
            </div>
            <div className="rounded-xl border border-[#1a1a2e]/10 bg-white/60 p-6 backdrop-blur-sm">
              <div className="mb-3 text-2xl">⏰</div>
              <h3 className="font-semibold text-[#1a1a2e]">Attendance</h3>
              <p className="mt-1 text-sm text-[#444]">
                Shift state machine with server timestamps and calendar view
              </p>
            </div>
          </div>

          <div className="mt-12 rounded-xl border border-[#1a1a2e]/10 bg-white/60 p-6 backdrop-blur-sm">
            <h2 className="text-lg font-semibold text-[#1a1a2e]">AI-Powered with MCP</h2>
            <p className="mt-2 text-sm text-[#444]">
              Connect Claude, ChatGPT, or any MCP-capable AI assistant directly to your Zulivio instance.
              Your AI can read tasks, check dashboards, log attendance, and create leads — all with
              your existing permissions.
            </p>
            <div className="mt-4 flex justify-center gap-3">
              <span className="inline-flex items-center rounded-full bg-[#10b981]/10 px-3 py-1 text-xs font-medium text-[#10b981]">
                Model Context Protocol
              </span>
              <span className="inline-flex items-center rounded-full bg-[#6366f1]/10 px-3 py-1 text-xs font-medium text-[#6366f1]">
                Available on Microsoft Store
              </span>
            </div>
          </div>

          <p className="mt-12 text-xs text-[#444]/60">
            Built by NodeDR Infotech Private Limited
          </p>
        </div>
      </div>
    </div>
  );
}
