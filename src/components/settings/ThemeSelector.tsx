import { Sun, Moon, Smartphone } from "lucide-react";
import { useTheme, type Theme } from "@/hooks/useTheme";
import { SettingsSection, ChipButton } from "./SettingsPrimitives";

const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Device Default", icon: Smartphone },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  return (
    <SettingsSection
      icon={Sun}
      title="Appearance"
      description="Choose your vibe — light, dark, or match your device."
    >
      <div className="flex gap-2">
        {themeOptions.map((opt) => {
          const Icon = opt.icon;
          return (
            <ChipButton key={opt.value} selected={theme === opt.value} onClick={() => setTheme(opt.value)}>
              <Icon className="h-3.5 w-3.5" />
              {opt.label}
            </ChipButton>
          );
        })}
      </div>
    </SettingsSection>
  );
}
