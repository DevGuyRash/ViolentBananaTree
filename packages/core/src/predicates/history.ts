interface HistoryEntry {
    predicateName: string;
    options: any;
    satisfied: boolean;
    error?: string;
    timestamp: number;
}

const history: HistoryEntry[] = [];

export const historyManager = {
    add(entry: Omit<HistoryEntry, 'timestamp'>) {
        history.push({ ...entry, timestamp: Date.now() });
    },
    getHistory() {
        return [...history];
    }
};
