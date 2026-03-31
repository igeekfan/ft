import React from 'react'
import {Button} from '@/components/ui/button'

interface ErrorBoundaryProps {
    children: React.ReactNode
}

interface ErrorBoundaryState {
    hasError: boolean
    error: Error | null
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props)
        this.state = {hasError: false, error: null}
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return {hasError: true, error}
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('ErrorBoundary caught:', error, errorInfo)
    }

    handleReset = () => {
        this.setState({hasError: false, error: null})
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex h-screen items-center justify-center bg-background">
                    <div className="text-center space-y-4 max-w-md p-6">
                        <div className="text-5xl">⚠️</div>
                        <h2 className="text-lg font-semibold">应用发生错误</h2>
                        <p className="text-sm text-muted-foreground break-all">
                            {this.state.error?.message || '未知错误'}
                        </p>
                        <div className="flex gap-2 justify-center">
                            <Button onClick={this.handleReset}>重试</Button>
                            <Button variant="outline" onClick={() => window.location.reload()}>
                                刷新页面
                            </Button>
                        </div>
                    </div>
                </div>
            )
        }
        return this.props.children
    }
}

export default ErrorBoundary
