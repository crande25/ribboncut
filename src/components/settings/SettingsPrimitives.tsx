import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface SettingsSectionProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  children: React.ReactNode;
}

/** Standard heading-icon-description block reused for each settings group. */
export function SettingsSection({ icon: Icon, title, description, children }: SettingsSectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {children}
    </section>
  );
}

interface ChipOption<V> {
  value: V;
  label: string;
}

/** Pill-style toggle button used by every multi-select group. */
export function ChipButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium transition-all no-select",
        selected
          ? "bg-primary text-primary-foreground shadow-md"
          : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
      )}
    >
      {children}
    </button>
  );
}

interface ChipMultiSelectProps<V extends string | number> {
  options: ChipOption<V>[];
  selected: V[];
  onToggle: (value: V) => void;
}

/** Multi-select chip group (price, dietary). */
export function ChipMultiSelect<V extends string | number>({
  options,
  selected,
  onToggle,
}: ChipMultiSelectProps<V>) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <ChipButton key={String(opt.value)} selected={selected.includes(opt.value)} onClick={() => onToggle(opt.value)}>
          {opt.label}
        </ChipButton>
      ))}
    </div>
  );
}

interface ChipSingleSelectProps<V extends string | number> {
  options: ChipOption<V>[];
  selected: V | null;
  onChange: (value: V | null) => void;
}

/** Single-select chip group with deselect-on-reclick (rating threshold). */
export function ChipSingleSelect<V extends string | number>({
  options,
  selected,
  onChange,
}: ChipSingleSelectProps<V>) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <ChipButton
          key={String(opt.value)}
          selected={selected === opt.value}
          onClick={() => onChange(selected === opt.value ? null : opt.value)}
        >
          {opt.label}
        </ChipButton>
      ))}
    </div>
  );
}
