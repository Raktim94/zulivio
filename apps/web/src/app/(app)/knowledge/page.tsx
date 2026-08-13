"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, ErrorState, FileInput, Input, Spinner } from "@/components/ui";
import { TipsFeed, TrainingFeed } from "@/components/tips-and-training";
import { useCurrentEmployee, isManagerOrAbove } from "@/lib/use-current-employee";

interface KnowledgeDocument {
  id: string;
  title: string;
  description: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  fileName: string;
  createdAt: string;
}

export default function KnowledgePage() {
  const { data: employee } = useCurrentEmployee();
  const managerView = isManagerOrAbove(employee?.role);
  const queryClient = useQueryClient();

  const { data: documents, isLoading, error } = useQuery<KnowledgeDocument[]>({
    queryKey: ["knowledge", "documents"],
    queryFn: () => api.get<KnowledgeDocument[]>("/api/v1/knowledge/documents"),
  });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [tipTitle, setTipTitle] = useState("");
  const [tipBody, setTipBody] = useState("");
  const [tipError, setTipError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("Choose a PDF file first");
      return api.upload("/api/v1/knowledge/documents", file, { title, description });
    },
    onSuccess: () => {
      setTitle("");
      setDescription("");
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ["knowledge", "documents"] });
    },
    onError: (err) => setUploadError(err instanceof ApiError ? err.message : "Upload failed"),
  });

  const publish = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/knowledge/documents/${id}/publish`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["knowledge", "documents"] }),
  });

  const createTip = useMutation({
    mutationFn: () => api.post("/api/v1/tips", { title: tipTitle, body: tipBody }),
    onSuccess: () => {
      setTipTitle("");
      setTipBody("");
      queryClient.invalidateQueries({ queryKey: ["tips", "feed"] });
    },
    onError: (err) => setTipError(err instanceof ApiError ? err.message : "Could not publish tip"),
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Knowledge base & tips</h1>
        <p className="text-sm text-muted">Training PDFs and daily tips for the whole team.</p>
      </div>

      {managerView && (
        <Card>
          <h2 className="mb-4 text-sm font-medium text-ink">Upload training document</h2>
          {uploadError && <div className="mb-3"><ErrorState message={uploadError} /></div>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setUploadError(null);
              upload.mutate();
            }}
            className="grid grid-cols-1 gap-3 md:grid-cols-3"
          >
            <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            <Input
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <FileInput value={file} onChange={setFile} accept="application/pdf" label="Choose PDF file" required />
            <div className="md:col-span-3">
              <Button type="submit" disabled={upload.isPending}>
                {upload.isPending ? "Uploading..." : "Upload PDF"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <h2 className="mb-4 text-sm font-medium text-ink">Documents</h2>
        {isLoading ? (
          <Spinner />
        ) : error ? (
          <ErrorState message="Could not load documents." />
        ) : !documents || documents.length === 0 ? (
          <p className="text-sm text-muted">No documents yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between border-b border-border pb-3 last:border-0">
                <div>
                  <p className="text-sm font-medium text-ink">{doc.title}</p>
                  {doc.description && <p className="text-xs text-muted">{doc.description}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={doc.status === "PUBLISHED" ? "success" : "neutral"}>{doc.status}</Badge>
                  {managerView && doc.status === "DRAFT" && (
                    <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => publish.mutate(doc.id)}>
                      Publish
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {managerView && (
        <Card>
          <h2 className="mb-4 text-sm font-medium text-ink">Publish a tip</h2>
          {tipError && <div className="mb-3"><ErrorState message={tipError} /></div>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setTipError(null);
              createTip.mutate();
            }}
            className="flex flex-col gap-3"
          >
            <Input placeholder="Title" value={tipTitle} onChange={(e) => setTipTitle(e.target.value)} required />
            <Input placeholder="Tip content" value={tipBody} onChange={(e) => setTipBody(e.target.value)} required />
            <div>
              <Button type="submit" disabled={createTip.isPending}>
                {createTip.isPending ? "Publishing..." : "Publish tip"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <TipsFeed />
        <TrainingFeed />
      </div>
    </div>
  );
}
