export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

export async function maybeYield(counter: number, every = 50): Promise<void> {
  if (counter % every === 0) {
    await yieldToEventLoop();
  }
}
