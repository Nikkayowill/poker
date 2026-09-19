/**
 * One picture per stock, shared by everything that names one.
 *
 * It lived in stackacres-radial-menu.tsx until the seed ring was replaced by the
 * belt's seed wheel (stackacres-seed-wheel.tsx); the table outlived the menu it
 * was written for, so it moved out here rather than being copied.
 */

import type { StackAcresStock } from "@/lib/stackacres/catalogue";
import type { PainterName } from "./stackacres-art";

/** Which painter stands for a stock, matching the sidebar's own buy rows so the
 *  same thing is never two pictures. The seed wheel and the belt's own seed
 *  pouch both read it, rather than keeping a second copy of the same table. */
export const STOCK_ICON: Readonly<Record<StackAcresStock, PainterName>> = {
  // All 16 crops.
  bell_pepper: "ico-bell_pepper",
  broccoli: "ico-broccoli",
  cabbage: "ico-cabbage",
  carrot: "ico-carrot",
  celery: "ico-celery",
  corn: "ico-corn",
  eggplant: "ico-eggplant",
  green_bean: "ico-green_bean",
  lettuce: "ico-lettuce",
  onion: "ico-onion",
  pepper: "ico-pepper",
  potato: "ico-potato",
  radish: "ico-radish",
  spinach: "ico-spinach",
  tomato: "ico-tomato",
  wheat: "ico-wheat",
  hen: "hen",
  pig: "sheep",
  cattle: "cow",
};
