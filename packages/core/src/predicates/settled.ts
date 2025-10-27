import { Predicate } from './types';
import { observerManager } from './observer-manager';

interface SettledOptions {
  timeout?: number;
}

export const settled: Predicate<SettledOptions> = ({ timeout = 150 } = {}) => {
  return new Promise(resolve => {
    let timeoutId: any;

    const observer = new MutationObserver(() => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        observerManager.remove(observer);
        observer.disconnect();
        resolve(true);
      }, timeout);
    });

    timeoutId = setTimeout(() => {
      observerManager.remove(observer);
      observer.disconnect();
      resolve(true);
    }, timeout);

    observerManager.add(observer);
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
  });
};
