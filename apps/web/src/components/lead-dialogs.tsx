"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRight } from "lucide-react";
import type { CallDisposition, CallOutcome } from "@zulivio/types";
import { api, ApiError } from "@/lib/api";
import { Button, Dialog, Input, useToast } from "@/components/ui";
import { DISPOSITIONS_BY_OUTCOME, DISPOSITION_LABEL } from "@/components/crm";

/**
 * Single-tap disposition. The outcome toggle splits the list so the
 * telecaller taps one of a handful of options, not a long form.
 */
export function DispositionDialog({
  leadId,
  onClose,
  onDone,
}: {
  leadId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [outcome, setOutcome] = useState<CallOutcome>("CONNECTED");
  const [disposition, setDisposition] = useState<CallDisposition | null>(null);
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");

  const log = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/leads/${leadId}/calls/disposition`, {
        outcome,
        disposition,
        durationSeconds: duration ? Number(duration) : undefined,
        notes: notes || undefined,
        followUpAt: followUpAt ? new Date(followUpAt).toISOString() : undefined,
      }),
    onSuccess: () => {
      onDone();
      onClose();
      toast.push("Call logged", "success");
    },
    onError: (err) => toast.push(err instanceof ApiError ? err.message : "Could not log the call", "error"),
  });

  return (
    <Dialog open onClose={onClose} title="How did the call go?">
      <div className="flex flex-col gap-4">
        <div role="radiogroup" aria-label="Call outcome" className="flex gap-2">
          {(["CONNECTED", "NOT_CONNECTED"] as CallOutcome[]).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={outcome === option}
              onClick={() => {
                setOutcome(option);
                setDisposition(null);
              }}
              className={clsx(
                "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition",
                outcome === option
                  ? "border-emerald bg-emerald text-white"
                  : "border-border bg-surface text-ink hover:bg-canvas",
              )}
            >
              {option === "CONNECTED" ? "Connected" : "Not connected"}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {DISPOSITIONS_BY_OUTCOME[outcome].map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={disposition === option}
              onClick={() => setDisposition(option)}
              className={clsx(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                disposition === option
                  ? "border-emerald bg-emerald/10 text-emerald-dark"
                  : "border-border bg-surface text-muted hover:text-ink",
              )}
            >
              {DISPOSITION_LABEL[option]}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Duration (seconds, optional)
            <Input type="number" min="0" value={duration} onChange={(e) => setDuration(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Follow up at (optional)
            <Input type="datetime-local" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">
            Notes (optional)
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>

        <div className="flex gap-2">
          <Button disabled={!disposition || log.isPending} onClick={() => log.mutate()}>
            {log.isPending ? "Saving…" : "Save outcome"}
            <ArrowRight size={15} aria-hidden />
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function FollowUpDialog({
  leadId,
  onClose,
  onDone,
}: {
  leadId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [dueAt, setDueAt] = useState("");
  const [note, setNote] = useState("");

  const create = useMutation({
    mutationFn: (iso: string) => api.post(`/api/v1/leads/${leadId}/follow-ups`, { dueAt: iso, note: note || undefined }),
    onSuccess: () => {
      onDone();
      onClose();
      toast.push("Follow-up scheduled", "success");
    },
    onError: (err) => toast.push(err instanceof ApiError ? err.message : "Could not schedule", "error"),
  });

  /** The two dates a telecaller picks most, as one tap each. */
  function quick(hoursFromNow: number, atHour?: number) {
    const date = new Date();
    if (atHour !== undefined) {
      date.setDate(date.getDate() + Math.round(hoursFromNow / 24));
      date.setHours(atHour, 0, 0, 0);
    } else {
      date.setTime(date.getTime() + hoursFromNow * 60 * 60_000);
    }
    create.mutate(date.toISOString());
  }

  return (
    <Dialog open onClose={onClose} title="Schedule a follow-up">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={create.isPending} onClick={() => quick(2)}>
            In 2 hours
          </Button>
          <Button variant="secondary" disabled={create.isPending} onClick={() => quick(24, 10)}>
            Tomorrow 10 AM
          </Button>
          <Button variant="secondary" disabled={create.isPending} onClick={() => quick(72, 10)}>
            In 3 days
          </Button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (dueAt) create.mutate(new Date(dueAt).toISOString());
          }}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1 text-xs text-muted">
            Or pick a date and time
            <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Note (optional)
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should you cover?" />
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={!dueAt || create.isPending}>
              Schedule
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
