"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/app/_components/ErrorOverlay";

/* Catches a crash while rendering its children and shows the error + React
   component stack ON SCREEN (instead of a dead/blank area), so it can be
   screenshotted on a real device. Also forwards it to the red error banner. */
type Props = { label: string; children: ReactNode };
type State = { error: Error | null; componentStack: string };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const componentStack = info.componentStack ?? "";
    this.setState({ componentStack });
    reportError(`${this.props.label} crashed: ${error.message}`, `${error.stack ?? ""}\n\nComponent stack:${componentStack}`);
  }

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="m-4 rounded-2xl border border-red-300 bg-red-50 p-4 text-red-900">
        <p className="text-sm font-bold">{this.props.label} crashed — please screenshot this</p>
        <p className="mt-1 text-sm font-semibold break-words">{error.name}: {error.message}</p>
        <pre className="mt-2 max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white/70 p-2 font-mono text-[11px] leading-snug select-text">
          {`${typeof navigator !== "undefined" ? navigator.userAgent : ""}\n\n${error.stack ?? ""}\n\nComponent stack:${componentStack}`}
        </pre>
        <button type="button" onClick={() => this.setState({ error: null, componentStack: "" })}
          className="mt-3 h-10 rounded-xl bg-red-700 px-4 text-sm font-semibold text-white">
          Try again
        </button>
      </div>
    );
  }
}
