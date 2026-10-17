import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('NandForge view error', error, info.componentStack); }
  render() {
    if (this.state.error) return <section className="error-card" role="alert"><h2>This view could not be opened.</h2><p>{this.state.error.message}</p><p>Saved projects are retained in your browser. Return home and reopen the workspace.</p><button onClick={() => { this.setState({ error: null }); location.hash = '#/'; }}>Return home / Ana sayfaya dön</button></section>;
    return this.props.children;
  }
}
