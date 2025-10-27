import { Predicate } from './types';
import { observerManager } from './observer-manager';

interface StableOptions {
  selector: string;
  timeout?: number;
}

export const stable: Predicate<StableOptions> = ({ selector, timeout = 150 }) => {
  return new Promise((resolve, reject) => {
    const target = document.querySelector(selector);
    if (!target) {
      return reject(new Error(`[DGX] Element with selector "${selector}" not found.`));
    }

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
    observer.observe(target, { attributes: true, childList: true, subtree: true });
  });
};
