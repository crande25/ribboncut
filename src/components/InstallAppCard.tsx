import { useState } from "react";
import { Download, Share, Plus } from "lucide-react";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { cn } from "@/lib/utils";

export function InstallAppCard() {
  const { canInstall, isIOS, isStandalone, promptInstall } = useInstallPrompt();
  const [showIOSHelp, setShowIOSHelp] = useState(false);

  // Already installed, or no path to install — hide entirely
  if (isStandalone) return null;
  if (!canInstall && !isIOS) return null;

  const handleClick = async () => {
    if (canInstall) {
      await promptInstall();
    } else if (isIOS) {
      setShowIOSHelp((v) => !v);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Download className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Install App</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Add PlatePing to your home screen for one-tap access.
      </p>
      <button
        onClick={handleClick}
        className={cn(
          "inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium transition-all no-select",
          "bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
        )}
      >
        <Download className="h-3.5 w-3.5" />
        {canInstall ? "Install PlatePing" : "How to install"}
      </button>

      {isIOS && showIOSHelp && (
        <div className="rounded-lg border border-border bg-secondary/50 p-4 space-y-2 text-xs text-muted-foreground">
          <p className="text-foreground font-medium">On iPhone / iPad (Safari):</p>
          <ol className="space-y-1.5 list-decimal list-inside">
            <li className="flex items-center gap-1.5">
              <span>1. Tap the Share icon</span>
              <Share className="h-3.5 w-3.5 inline text-primary" />
              <span>at the bottom of Safari</span>
            </li>
            <li className="flex items-center gap-1.5">
              <span>2. Choose</span>
              <span className="text-foreground font-medium">Add to Home Screen</span>
              <Plus className="h-3.5 w-3.5 inline text-primary" />
            </li>
            <li>3. Tap <span className="text-foreground font-medium">Add</span> in the top right</li>
          </ol>
        </div>
      )}
    </section>
  );
}
