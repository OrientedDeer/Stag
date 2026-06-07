import { Component, ReactNode } from 'react';

interface SankeyErrorBoundaryProps {
    children: ReactNode;
    height: number;
    /** Changing this value resets the boundary so the chart can re-render with new data. */
    resetKey?: string;
}

interface SankeyErrorBoundaryState {
    hasError: boolean;
    error: unknown;
}

/**
 * Catches Nivo Sankey rendering errors and shows a recoverable error panel
 * with the exception details inside a collapsible <details>.
 */
export class SankeyErrorBoundary extends Component<
    SankeyErrorBoundaryProps,
    SankeyErrorBoundaryState
> {
    constructor(props: SankeyErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: unknown) {
        return { hasError: true, error };
    }

    componentDidUpdate(prevProps: SankeyErrorBoundaryProps) {
        if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
            this.setState({ hasError: false, error: null });
        }
    }

    render() {
        if (this.state.hasError) {
            return (
                <div
                    style={{ height: `${this.props.height}px` }}
                    className="flex items-center justify-center bg-negative-tint/10 border border-negative-strong rounded-lg"
                >
                    <div className="text-center p-6">
                        <div className="text-negative text-lg font-bold mb-2">Rendering Error</div>
                        <div className="text-content-default text-sm mb-2">
                            The chart failed to render. This is likely a data structure issue.
                        </div>
                        <details className="text-left">
                            <summary className="cursor-pointer text-content-muted text-xs hover:text-content-emphasis">
                                Error Details
                            </summary>
                            <pre className="mt-2 text-xs text-negative overflow-auto max-h-48 bg-surface-raised p-2 rounded">
                                {String(this.state.error)}
                            </pre>
                        </details>
                    </div>
                </div>
            );
        }

        return (
            <div style={{ height: `${this.props.height}px` }}>
                {this.props.children}
            </div>
        );
    }
}
