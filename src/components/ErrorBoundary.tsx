import * as React from 'react';

interface Props {
	children: React.ReactNode;
}

interface State {
	error: Error | null;
}

/** Catches render errors so the board never shows a silent gray page. */
export class ErrorBoundary extends React.Component<Props, State> {
	state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	componentDidCatch(_error: Error, _info: React.ErrorInfo): void {
		// Error is displayed in the UI via getDerivedStateFromError
	}

	render(): React.ReactNode {
		if (this.state.error) {
			return (
				<div className="board-error">
					<h3>ColorCoder failed to render this board</h3>
					<pre>{this.state.error.message}</pre>
					<button onClick={() => this.setState({ error: null })}>Retry</button>
				</div>
			);
		}
		return this.props.children;
	}
}