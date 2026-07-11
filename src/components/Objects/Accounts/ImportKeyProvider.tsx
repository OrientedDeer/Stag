import { useState, useCallback, useMemo, ReactNode } from 'react';
import { ImportKeyContext } from './ImportKeyContext';

export const ImportKeyProvider = ({ children }: { children: ReactNode }) => {
    const [importKey, setImportKey] = useState(0);

    const incrementImportKey = useCallback(() => {
        setImportKey(prev => prev + 1);
    }, []);

    const contextValue = useMemo(() => ({
        importKey,
        incrementImportKey,
    }), [importKey, incrementImportKey]);

    return (
        <ImportKeyContext.Provider value={contextValue}>
            {children}
        </ImportKeyContext.Provider>
    );
};
