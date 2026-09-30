/**
 * The wire contract for the Sit & Go waiting room's two ping channels.
 *
 * Same shape as lib/cribbage/crib-channel.ts. `sng:lobby` is shared by every
 * browser on the open-table list, since that list has no per-viewer filter,
 * and `sng:<tableId>` is what a seated player watches. The
 * `broadcast_sit_and_go_signal()` trigger sends both on every write to
 * `sit_and_go_tables` or `sit_and_go_table_players`. The payload carries
 * nothing, so the event firing is the signal and the client re-reads.
 */

export const SNG_STATE_CHANGED = "SNG_STATE_CHANGED";

export function sitAndGoLobbyChannelName(): string {
  return "sng:lobby";
}

export function sitAndGoTableChannelName(tableId: string): string {
  return `sng:${tableId}`;
}
