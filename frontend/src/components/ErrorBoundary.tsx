/**
 * Panel-level error boundary.
 *
 * Every page and every heavy panel (charts, the 3D twin) is wrapped in one of
 * these. A single component throwing must degrade to a labelled box in that
 * component's place, not a white screen -- on a portfolio site a white screen
 * is indistinguishable from a broken deployment.
 *
 * Class component because error boundaries have no hook equivalent in React.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw, ShieldAlert } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Shown in the fallback so the reader knows which panel failed. */
  panelName: string
  /** Compact fallback for small panels. */
  compact?: boolean
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept as a console record: there is no error-reporting backend in this
    // project and inventing one would be scope the brief does not ask for.
    console.error(`[PumpGuard DT] ${this.props.panelName} failed`, error, info.componentStack)
  }

  private reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        role="alert"
        className={`flex flex-col items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 ${
          this.props.compact ? 'p-3' : 'p-5'
        }`}
      >
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5" aria-hidden />
          <p className="text-sm font-semibold">{this.props.panelName} could not be displayed</p>
        </div>
        <p className="text-sm">
          This panel failed to render. The rest of the page is unaffected and still live.
        </p>
        <code className="numeric max-w-full overflow-x-auto rounded border border-amber-300 bg-white/70 px-2 py-1 text-xs">
          {error.message || String(error)}
        </code>
        <button type="button" className="btn btn-secondary" onClick={this.reset}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          Retry this panel
        </button>
      </div>
    )
  }
}
