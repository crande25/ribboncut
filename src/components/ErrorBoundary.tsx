import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Render error:", error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border py-12 px-6 text-center animate-fade-in">
        <AlertTriangle className="h-10 w-10 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Something went sideways</p>
          <p className="text-xs text-muted-foreground">
            This page hit an unexpected error. Try reloading — if it keeps happening, use Contact us in Settings.
          </p>
        </div>
        {this.state.error?.message && (
          <p className="max-w-full overflow-hidden text-ellipsis rounded-md bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
            {this.state.error.message}
          </p>
        )}
        <button
          onClick={this.handleReload}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <RefreshCw className="h-4 w-4" />
          Reload
        </button>
      </div>
    );
  }
}
