import { useState, useEffect } from 'react';

export function useSessionStorage<T>(key: string, initialValue: T) {
    const [storedValue, setStoredValue] = useState<T>(() => {
        try {
            if (typeof window !== 'undefined') {
                const item = window.sessionStorage.getItem(key);
                return item ? JSON.parse(item) : initialValue;
            }
            return initialValue;
        } catch (error) {
            console.warn(`Error reading sessionStorage key "${key}":`, error);
            return initialValue;
        }
    });

    useEffect(() => {
        try {
            if (typeof window !== 'undefined') {
                window.sessionStorage.setItem(key, JSON.stringify(storedValue));
            }
        } catch (error) {
            console.warn(`Error setting sessionStorage key "${key}":`, error);
        }
    }, [key, storedValue]);

    return [storedValue, setStoredValue] as const;
}
