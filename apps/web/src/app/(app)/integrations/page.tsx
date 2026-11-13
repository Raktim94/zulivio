"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Badge, Card, ErrorState, Skeleton, Spinner, Tabs, TabPanel } from "@/components/ui";
import { isAdminOrAbove } from "@/lib/use-current-employee";
import { useRequireRole } from "@/lib/use-require-role";
import { ApiClientsPanel } from "@/components/integrations/api-clients";
import { WebhooksPanel } from "@/components/integrations/webhooks";
import { TelephonyPanel } from "@/components/integrations/telephony";
import { STATUS_LABEL, statusTone, type Catalog } from "@/components/integrations/shared";

interface DirectoryItem {
  key: string;
  name: string;
  description: string;
  status: string;
  detail: string;
  href: string;
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "api-clients", label: "API clients" },
  { id: "webhooks", label: "Webhooks" },
  { id: "telephony", label: "Telephony" },
];

export default function IntegrationsPage() {
  const { authorized, isLoading } = useRequireRole(isAdminOrAbove);
  const [tab, setTab] = useState("overview");
  const catalog = useQuery<Catalog>({ queryKey: ["integrations", "catalog"], queryFn: () => api.get("/api/v1/integrations/catalog"), enabled: authorized });
  const directory = useQuery<{ apiVersion: string; items: DirectoryItem[] }>({ queryKey: ["integrations", "directory"], queryFn: () => api.get("/api/v1/integrations/directory"), enabled: authorized });

  if (isLoading || !authorized) return <Spinner />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Integrations &amp; API</h1>
        <p className="text-sm text-muted">Connect other software to your Zulivio server. Everything here stays on your server; nothing is sent to NodeDR.</p>
      </div>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <TabPanel id="overview" active={tab}>
        {directory.isLoading ? <Skeleton className="h-40" /> : directory.error ? (
          <ErrorState message={directory.error instanceof ApiError ? directory.error.message : "Couldn't load integrations."} />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {directory.data?.items.map((i) => (
              <li key={i.key}>
                <Card className="h-full">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-sm font-semibold text-ink">{i.name}</h2>
                    <Badge tone={statusTone(i.status)}>{STATUS_LABEL[i.status] ?? i.status}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted">{i.description}</p>
                  <p className="mt-2 text-xs text-muted">{i.detail}</p>
                  <div className="mt-3 text-sm">
                    {["api-clients", "webhooks", "telephony"].includes(i.key) ? (
                      <button type="button" onClick={() => setTab(i.key)} className="font-medium text-emerald-dark hover:underline">Manage</button>
                    ) : (
                      <Link href={i.href} className="font-medium text-emerald-dark hover:underline">Open</Link>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-muted">
          API version {directory.data?.apiVersion ?? "…"}. Documentation: <a className="text-emerald-dark underline" href="/docs">Zulivio docs</a> (see “Integrations &amp; API” and “Android app”).
        </p>
      </TabPanel>
      <TabPanel id="api-clients" active={tab}>
        <ApiClientsPanel catalog={catalog.data} />
      </TabPanel>
      <TabPanel id="webhooks" active={tab}>
        <WebhooksPanel catalog={catalog.data} />
      </TabPanel>
      <TabPanel id="telephony" active={tab}>
        <TelephonyPanel catalog={catalog.data} />
      </TabPanel>
    </div>
  );
}
