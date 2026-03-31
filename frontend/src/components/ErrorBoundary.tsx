import React from 'react'
import {Button} from '@/components/ui/button'
import {useI18n} from '../i18n/context'

interface ErrorBoundaryProps {
    children: React.ReactNode
}

interface ErrorBoundaryState {
    hasError: boolean
    error: Error | null
}

class ErrorBoundaryInner extends React.Component<ErrorBoundaryProps & {t: (key: string) => string}, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps & {t: (key: string) => string}) {
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
            const {t} = this.props
            return (
                <div className="flex h-screen items-center justify-center bg-background">
                    <div className="text-center space-y-4 max-w-md p-6">
                        <div className="text-5xl">⚠️</div>
                        <h2 className="text-lg font-semibold">{t('errorBoundary.title')}</h2>
                        <p className="text-sm text-muted-foreground break-all">
                            {this.state.error?.message || 'Unknown error'}
                        </p>
                        <div className="flex gap-2 justify-center">
                            <Button onClick={this.handleReset}>{t('errorBoundary.retry')}</Button>
                            <Button variant="outline" onClick={() => window.location.reload()}>
                                {t('errorBoundary.reload')}
                            </Button>
                        </div>
                    </div>
                </div>
            )
        }
        return this.props.children
    }
}

function ErrorBoundary({children}: ErrorBoundaryProps) {
    const {t} = useI18n()
    return <ErrorBoundaryInner t={t}>{children}</ErrorBoundaryInner>
}

export default ErrorBoundary
