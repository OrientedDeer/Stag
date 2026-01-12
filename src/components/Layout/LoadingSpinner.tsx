import React from 'react';

interface LoadingSpinnerProps {
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ size = 'md', className = '' }) => {
    const sizeClasses = {
        sm: 'w-4 h-4 border-2',
        md: 'w-8 h-8 border-3',
        lg: 'w-12 h-12 border-4'
    };

    return (
        <div
            className={`${sizeClasses[size]} border-gray-700 border-t-green-500 rounded-full animate-spin ${className}`}
            role="status"
            aria-label="Loading"
        />
    );
};

interface LoadingOverlayProps {
    message?: string;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ message = 'Loading...' }) => {
    return (
        <div className="absolute inset-0 bg-gray-900/80 backdrop-blur-sm flex flex-col items-center justify-center z-10 rounded-2xl">
            <LoadingSpinner size="lg" />
            <p className="mt-4 text-gray-300 text-sm font-medium">{message}</p>
        </div>
    );
};

interface SkeletonProps {
    className?: string;
    style?: React.CSSProperties;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = '', style }) => {
    return (
        <div className={`bg-gray-800 animate-pulse rounded ${className}`} style={style} />
    );
};

interface ChartSkeletonProps {
    height?: string;
}

export const ChartSkeleton: React.FC<ChartSkeletonProps> = ({ height = 'h-64' }) => {
    return (
        <div className={`${height} w-full flex flex-col gap-2 p-4`}>
            {/* Chart title skeleton */}
            <Skeleton className="h-6 w-32 mb-4" />

            {/* Chart area skeleton */}
            <div className="flex-1 flex items-end gap-2">
                {Array.from({ length: 12 }).map((_, i) => (
                    <Skeleton
                        key={i}
                        className="flex-1"
                        style={{ height: `${30 + Math.random() * 60}%` } as React.CSSProperties}
                    />
                ))}
            </div>

            {/* X-axis labels skeleton */}
            <div className="flex justify-between mt-2">
                {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-3 w-8" />
                ))}
            </div>
        </div>
    );
};
