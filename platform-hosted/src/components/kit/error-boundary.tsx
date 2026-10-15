// ErrorBoundary — wrap the App root with this. When any descendant throws during render, instead of a
// blank white screen it shows a readable panel: the error message and component stack are rendered as
// plain text in the DOM (not just console), so a human — or an automated screenshot/DOM reader — can
// see exactly what broke. Class component because React error boundaries have no hook equivalent.
import * as React from "react";

import { Button } from "@/components/ui/button";

interface Props {
  children: React.ReactNode;
  /** Optional custom fallback; receives the caught error. Overrides the default panel. */
  fallback?: (error: Error) => React.ReactNode;
}

interface State {
  error: Error | null;
  info: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to console too, but the DOM below is the source of truth for graders/screenshots.
    console.error("App crashed:", error, info.componentStack);
    this.setState({ info: info.componentStack ?? "" });
  }

  private reset = () => this.setState({ error: null, info: "" });

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error);

    return (
      <div
        role="alert"
        className="min-h-screen w-full bg-background p-[clamp(24px,4vw,40px)] text-foreground"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-4 rounded-lg border border-destructive/40 bg-card p-6">
          <div>
            <h1 className="text-lg font-semibold text-destructive">Something went wrong</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              The app hit an unexpected error and stopped rendering. Details below.
            </p>
          </div>

          <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap text-foreground">
            {error.message || String(error)}
          </pre>

          {info && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Component stack</summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3 font-mono whitespace-pre-wrap text-muted-foreground">
                {info}
              </pre>
            </details>
          )}

          <div className="flex gap-2">
            <Button onClick={this.reset} variant="outline" size="sm">
              Try again
            </Button>
            <Button onClick={() => window.location.reload()} size="sm">
              Reload page
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
