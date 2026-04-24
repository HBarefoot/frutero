import { Component } from 'react';
import { AlertTriangle, Home, RefreshCw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardTitleGroup,
} from '@/components/ui/card';
import { reportClientError } from '@/lib/api';

// Two layers of protection:
//   <ErrorBoundary scope="app"> wraps everything below <AuthGate>, so a
//     crash anywhere in the app tree still leaves the browser on a
//     usable fallback page with log-out / reload options.
//   <ErrorBoundary scope="page"> wraps each page route, so a crash on
//     one page doesn't blank the sidebar.
//
// Rules for the fallback:
//   - Never throw from inside the fallback (would cascade).
//   - `reportClientError` is a best-effort POST that swallows its own
//     errors so a reload loop can't nuke the backend.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, reportSent: false, reportBusy: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Console log for developer visibility even when fallback renders.
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary ${this.props.scope || 'unknown'}]`, error, info);
  }

  reset = () => {
    this.setState({ error: null, reportSent: false, reportBusy: false });
  };

  reload = () => {
    window.location.reload();
  };

  goHome = () => {
    window.location.assign('/');
  };

  report = async () => {
    if (this.state.reportSent || this.state.reportBusy) return;
    this.setState({ reportBusy: true });
    try {
      await reportClientError({
        path: typeof window !== 'undefined' ? window.location.pathname : '',
        message: this.state.error?.message || String(this.state.error),
        stack: this.state.error?.stack || null,
        scope: this.props.scope || 'unknown',
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      });
      this.setState({ reportSent: true });
    } catch {
      // Never surface a reporting failure — the user already saw the primary error.
    } finally {
      this.setState({ reportBusy: false });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    const { scope = 'app' } = this.props;
    const isApp = scope === 'app';
    const title = isApp ? 'Something went wrong' : 'This page crashed';
    const description = isApp
      ? 'The interface hit an unexpected error and stopped rendering. Your chamber is still running from the last good state.'
      : 'The rest of the app is still working — use the sidebar to navigate elsewhere.';

    return (
      <div className={isApp ? 'min-h-screen bg-background p-4 sm:p-8' : 'p-4'}>
        <div className="mx-auto max-w-2xl">
          <Card className="border-danger/30">
            <CardHeader>
              <CardTitleGroup>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="size-4 text-danger" />
                  <CardTitle>{title}</CardTitle>
                </div>
                <CardDescription>{description}</CardDescription>
              </CardTitleGroup>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-border bg-background/40 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Error
                </div>
                <div className="mt-1 break-words font-mono text-xs text-danger">
                  {this.state.error?.message || String(this.state.error)}
                </div>
              </div>

              {this.state.error?.stack && (
                <details className="rounded-md border border-border bg-background/40 p-3 text-xs">
                  <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                    Show stack trace
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
                    {this.state.error.stack}
                  </pre>
                </details>
              )}

              <div className="flex flex-wrap gap-2">
                <Button onClick={this.reload} variant="default" size="sm">
                  <RefreshCw />
                  Reload
                </Button>
                {isApp && (
                  <Button onClick={this.goHome} variant="outline" size="sm">
                    <Home />
                    Go home
                  </Button>
                )}
                {!isApp && (
                  <Button onClick={this.reset} variant="outline" size="sm">
                    <RefreshCw />
                    Retry page
                  </Button>
                )}
                <Button
                  onClick={this.report}
                  variant="ghost"
                  size="sm"
                  disabled={this.state.reportSent || this.state.reportBusy}
                >
                  <Send />
                  {this.state.reportSent ? 'Reported' : this.state.reportBusy ? 'Reporting…' : 'Report to owner'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }
}
