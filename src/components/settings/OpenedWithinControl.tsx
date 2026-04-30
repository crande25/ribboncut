import { useState } from "react";
import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { SettingsSection, ChipButton } from "./SettingsPrimitives";

const openedWithinUnits = [
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
  { value: "months", label: "Months" },
] as const;

const maxValues: Record<string, number> = { days: 365, weeks: 52, months: 12 };

interface OpenedWithinControlProps {
  value: number;
  unit: string;
  onValueChange: (value: number) => void;
  onUnitChange: (unit: string) => void;
}

export function OpenedWithinControl({
  value,
  unit,
  onValueChange,
  onUnitChange,
}: OpenedWithinControlProps) {
  const [rawInput, setRawInput] = useState<string>(String(value));
  const currentMax = maxValues[unit] || 12;
  const parsedRaw = parseInt(rawInput);
  const validationError =
    isNaN(parsedRaw) || parsedRaw > currentMax ? `Max is ${currentMax} ${unit}` : null;

  return (
    <SettingsSection
      icon={Calendar}
      title="Opened Within"
      description="Only show places first spotted in the last…"
    >
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={currentMax}
            value={rawInput}
            onChange={(e) => {
              setRawInput(e.target.value);
              const v = parseInt(e.target.value);
              if (!isNaN(v) && v >= 1 && v <= currentMax) {
                onValueChange(v);
              }
            }}
            onBlur={() => {
              const v = Math.max(1, Math.min(currentMax, parsedRaw || 1));
              onValueChange(v);
              setRawInput(String(v));
            }}
            className={cn(
              "w-16 rounded-lg border bg-secondary px-3 py-2 text-xs text-foreground text-center focus:outline-none focus:ring-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
              validationError
                ? "border-destructive focus:ring-destructive"
                : "border-border focus:ring-primary",
            )}
          />
          <div className="flex gap-2">
            {openedWithinUnits.map((opt) => (
              <ChipButton
                key={opt.value}
                selected={unit === opt.value}
                onClick={() => {
                  onUnitChange(opt.value);
                  const max = maxValues[opt.value] || 12;
                  if (value > max) {
                    onValueChange(max);
                    setRawInput(String(max));
                  }
                }}
              >
                {opt.label}
              </ChipButton>
            ))}
          </div>
        </div>
        {validationError && <p className="text-xs text-destructive">{validationError}</p>}
      </div>
    </SettingsSection>
  );
}
