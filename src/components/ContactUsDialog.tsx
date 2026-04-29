import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useDeviceId } from "@/hooks/useDeviceId";
import { cn } from "@/lib/utils";

const feedbackSchema = z.object({
  message: z.string().trim().min(1, "Please enter a message").max(2000, "Max 2000 characters"),
  email: z
    .string()
    .trim()
    .max(255, "Email too long")
    .email("Invalid email")
    .optional()
    .or(z.literal("")),
});

interface ContactUsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ContactUsDialog({ open, onOpenChange }: ContactUsDialogProps) {
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const deviceId = useDeviceId();

  const reset = () => {
    setMessage("");
    setEmail("");
    setSubmitting(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
    reset();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = feedbackSchema.safeParse({ message, email });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    const senderEmail = parsed.data.email ? parsed.data.email : null;
    const trimmedMessage = parsed.data.message;
    const id = crypto.randomUUID();

    setSubmitting(true);
    const { error: insertError } = await supabase.from("feedback").insert({
      id,
      message: trimmedMessage,
      sender_email: senderEmail,
      device_id: deviceId,
    });

    if (insertError) {
      setSubmitting(false);
      toast.error("Could not send. Please try again.");
      return;
    }

    // Best-effort email notification
    supabase.functions
      .invoke("send-transactional-email", {
        body: {
          templateName: "feedback-received",
          recipientEmail: "crande25@gmail.com",
          idempotencyKey: `feedback-${id}`,
          replyTo: senderEmail ?? undefined,
          templateData: {
            message: trimmedMessage,
            senderEmail: senderEmail ?? undefined,
            feedbackId: id,
            submittedAt: new Date().toISOString(),
          },
        },
      })
      .catch(() => {
        /* durable record already saved */
      });

    toast.success("Thanks, message received!");
    onOpenChange(false);
    reset();
  };

  const messageEmpty = message.trim().length === 0;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? onOpenChange(true) : handleCancel())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background p-5 shadow-xl focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <Dialog.Title className="text-base font-semibold text-foreground">
                Contact us
              </Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground">
                Send a quick note. We read every message.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="feedback-email">
                Your email <span className="opacity-60">(optional)</span>
              </label>
              <input
                id="feedback-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                maxLength={255}
                disabled={submitting}
                className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="feedback-message">
                Message
              </label>
              <textarea
                id="feedback-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Tell us what's on your mind…"
                rows={5}
                maxLength={2000}
                required
                disabled={submitting}
                className="w-full resize-none rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-right text-[10px] text-muted-foreground">
                {message.length}/2000
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={handleCancel}
                disabled={submitting}
                className="rounded-full bg-secondary px-4 py-2 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || messageEmpty}
                className={cn(
                  "rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-all",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  !submitting && !messageEmpty && "shadow-md hover:bg-primary/90"
                )}
              >
                {submitting ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
