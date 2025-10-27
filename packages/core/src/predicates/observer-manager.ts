const activeObservers = new Set<MutationObserver>();

export const observerManager = {
    add(observer: MutationObserver) {
        activeObservers.add(observer);
    },
    remove(observer: MutationObserver) {
        activeObservers.delete(observer);
    },
    cleanup() {
        activeObservers.forEach(observer => {
            try {
                observer.disconnect();
            } catch (e) {
                console.error('[DGX] Error disconnecting observer:', e);
            }
        });
        activeObservers.clear();
    }
};
