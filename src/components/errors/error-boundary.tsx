'use client';
import { Component, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error) => void;
};

type State = { error: Error | null };

// React error boundary with a calm, premium fallback.
// Catches JS errors that aren't caught elsewhere.

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
    // Log to telemetry silently
    fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'error', errorClass: error.name, message: error.message, source: 'error-boundary', route: typeof window !== 'undefined' ? window.location.pathname : undefined }),
    }).catch(() => {});
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 240, padding: 32, textAlign: 'center', gap: 16 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <path d="M14 10v6M14 19v.01" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <p style={{ fontFamily: '"Manrope", sans-serif', fontWeight: 700, fontSize: 15, color: '#0a0a0a', margin: '0 0 6px' }}>
              Something went wrong
            </p>
            <p style={{ fontFamily: '"Manrope", sans-serif', fontSize: 13, color: '#737373', lineHeight: 1.55, margin: 0 }}>
              We've logged this and are looking into it. Try refreshing — your work is still here.
            </p>
          </div>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{ fontFamily: '"Manrope", sans-serif', fontWeight: 600, fontSize: 12, padding: '9px 18px', borderRadius: 999, border: '1px solid #e5e5e5', background: '#fff', cursor: 'pointer', color: '#0a0a0a' }}
          >
            Refresh page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
