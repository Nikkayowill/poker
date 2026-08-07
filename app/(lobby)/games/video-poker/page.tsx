import type { Metadata } from "next";
import { VideoPokerMachine } from "@/components/arcade/video-poker-machine";

export const metadata: Metadata = {
  title: "Video Poker · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/video-poker -- the parens are not a path segment. */
export default function VideoPokerPage() {
  return <VideoPokerMachine />;
}
