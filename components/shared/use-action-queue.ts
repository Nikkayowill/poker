"use client";

import { useCallback, useState } from "react";
import { createActionQueue, type RequestSequence } from "@/lib/ui/request-sequence";

/**
 * createActionQueue for a component. `pending` is state so the board can paint
 * queued taps, and `queued()` reads the same list synchronously in a handler.
 */
export function useActionQueue<T>(
  sequence: Pick<RequestSequence, "beginWrite">,
  run: (item: T) => Promise<boolean>,
) {
  const [pending, setPending] = useState<readonly T[]>([]);
  const [queue] = useState(() => createActionQueue<T>({ sequence, onChange: setPending }));

  const push = useCallback((item: T) => {
    queue.push(item);
    void queue.drain(run);
  }, [queue, run]);
  const clear = useCallback(() => queue.clear(), [queue]);
  const queued = useCallback(() => queue.pending(), [queue]);

  return { pending, push, clear, queued };
}
