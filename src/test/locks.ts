export function installTestLocks() {
  const previous = Object.getOwnPropertyDescriptor(navigator, 'locks');
  const queues = new Map<string, Promise<unknown>>();
  const request = <T>(name: string, operation: () => Promise<T>) => {
    const next = (queues.get(name) ?? Promise.resolve()).then(operation);
    queues.set(name, next.catch(() => undefined));
    return next;
  };
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
  return () => {
    if (previous) Object.defineProperty(navigator, 'locks', previous);
    else Reflect.deleteProperty(navigator, 'locks');
  };
}
