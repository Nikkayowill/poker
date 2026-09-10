/**
 * The watering can.
 *
 * Watering a dry crop by hand spends one unit of water. Tapping the well
 * fills the can back up. Pipes laid off a well water what they reach on
 * their own and never touch the can, which is the point of laying them.
 *
 * A player who has never drawn water has a full can, so nobody starts out
 * stuck. The server, the optimistic layer and the HUD all read this one
 * number.
 */
export const WATER_CAPACITY = 12;
