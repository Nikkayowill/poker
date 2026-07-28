"use client";

import { useState } from "react";
import { LockKeyhole } from "lucide-react";

export function RoomCodeChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const link = `${window.location.origin}/?code=${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be denied by browser policy; the code is still visible to copy by hand.
    }
  };
  return (
    <button type="button" className="room-code-chip" onClick={copy}>
      <LockKeyhole size={12} /> Code {code} <span>{copied ? "Copied!" : "Copy invite"}</span>
    </button>
  );
}
