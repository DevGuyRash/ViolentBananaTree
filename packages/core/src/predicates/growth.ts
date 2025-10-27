import { Predicate } from './types';
import { observerManager } from './observer-manager';

interface GrowthOptions {
  selector: string;
  timeout?: number;
}

export const growth: Predicate<GrowthOptions> = ({ selector, timeout = 5000 }) => {
  return new Promise((resolve, reject) => {
    const target = document.querySelector(selector);
    if (!target) {
      return reject(new Error(`[DGX] Element with selector "${selector}" not found.`));
    }

    const initialCount = target.children.length;
    let timeoutId: any;

    const observer = new MutationObserver(() => {
      if (target.children.length > initialCount) {
        clearTimeout(timeoutId);
        observerManager.remove(observer);
        observer.disconnect();
        resolve(true);
      }
    });

    timeoutId = setTimeout(() => {
      observerManager.remove(observer);
      observer.disconnect();
      resolve(false);
    }, timeout);

    observerManager.add(observer);
    observer.observe(target, { childList: true });
  });
};
