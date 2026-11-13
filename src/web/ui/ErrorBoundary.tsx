import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error?: Error }

/** 把渲染错误显示在页面上而不是白屏；生产排障也需要它。 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = {};
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('render error', error, info); }
  render() {
    if (this.state.error) return (
      <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-2 p-6">
        <h1 className="text-xl font-semibold">渲染错误</h1>
        <pre className="max-w-2xl whitespace-pre-wrap break-words text-sm opacity-80">{this.state.error.message}</pre>
        <pre className="max-w-2xl whitespace-pre-wrap break-words text-xs opacity-50">{this.state.error.stack?.slice(0, 1500)}</pre>
      </div>
    );
    return this.props.children;
  }
}
