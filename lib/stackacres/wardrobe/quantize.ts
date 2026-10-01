/**
 * Pillow's median-cut quantizer (`Image.quantize(method=MEDIANCUT)`, libImaging/Quant.c `quantize`
 * with kmeans 0), ported so the baked farmer's 48-colour palette is the one build.py's `paletted`
 * picks, pixel for pixel.
 *
 * The steps, as Quant.c numbers them: count the colours, sort them on each axis, split the box
 * with the most pixels at its median until there are enough boxes, average each box, then map every
 * pixel to the nearest average, searching outward from its own box's average.
 *
 * Quant.c coarsens colours once more than 65536 distinct ones are seen; a character sheet has a few
 * thousand, so that path is not ported and throws instead.
 */

const MAX_HASH_ENTRIES = 65536;

interface Box {
  /** Colour indices sorted high to low on each axis (r, g, b). */
  sorted: [Int32Array, Int32Array, Int32Array];
  pixelCount: number;
  volume: number;
  left: Box | null;
  right: Box | null;
}

/** Quant.c's binary heap (QuantHeap.c): 1-based, largest pixelCount on top, same tie behaviour. */
class BoxHeap {
  private readonly heap: (Box | null)[] = [null];
  private count = 0;

  private static cmp(a: Box, b: Box): number {
    return a.pixelCount - b.pixelCount;
  }

  add(val: Box): void {
    let k = ++this.count;
    while (k !== 1) {
      const parent = this.heap[k >> 1] as Box;
      if (BoxHeap.cmp(val, parent) <= 0) break;
      this.heap[k] = parent;
      k >>= 1;
    }
    this.heap[k] = val;
  }

  remove(): Box | null {
    if (!this.count) return null;
    const top = this.heap[1] as Box;
    const v = this.heap[this.count--] as Box;
    let k = 1;
    let l: number;
    for (; k * 2 <= this.count; k = l) {
      l = k * 2;
      if (l < this.count && BoxHeap.cmp(this.heap[l] as Box, this.heap[l + 1] as Box) < 0) l++;
      if (BoxHeap.cmp(v, this.heap[l] as Box) > 0) break;
      this.heap[k] = this.heap[l];
    }
    this.heap[k] = v;
    return top;
  }
}

export interface Quantized {
  /** rgb triples, `length / 3` entries. */
  readonly palette: Uint8Array;
  /** One palette index per pixel. */
  readonly indices: Uint8Array;
}

/**
 * `rgb` holds three bytes per pixel. Returns at most `colours` palette entries (fewer only when
 * the picture has fewer colours than that).
 */
export function quantizeMedianCut(rgb: Uint8Array, colours: number): Quantized {
  const nPixels = rgb.length / 3;
  // 1. Count each distinct colour.
  const indexOf = new Map<number, number>();
  const pixelColour = new Int32Array(nPixels);
  const keys: number[] = [];
  const counts: number[] = [];
  for (let i = 0, p = 0; i < nPixels; i++, p += 3) {
    const key = (rgb[p] << 16) | (rgb[p + 1] << 8) | rgb[p + 2];
    let idx = indexOf.get(key);
    if (idx === undefined) {
      idx = keys.length;
      indexOf.set(key, idx);
      keys.push(key);
      counts.push(0);
      if (keys.length > MAX_HASH_ENTRIES) throw new Error("too many colours to quantize exactly");
    }
    counts[idx]++;
    pixelColour[i] = idx;
  }
  const n = keys.length;
  const chan: [Int32Array, Int32Array, Int32Array] = [new Int32Array(n), new Int32Array(n), new Int32Array(n)];
  for (let i = 0; i < n; i++) {
    chan[0][i] = keys[i] >> 16;
    chan[1][i] = (keys[i] >> 8) & 255;
    chan[2][i] = keys[i] & 255;
  }

  // 2. The colours sorted on each axis, high to low. The order among equal values never changes
  //    which colours land in which box, so any stable order will do.
  const all = Array.from({ length: n }, (_v, i) => i);
  const sortedOn = (axis: number) => Int32Array.from([...all].sort((a, b) => chan[axis][b] - chan[axis][a]));
  const root: Box = {
    sorted: [sortedOn(0), sortedOn(1), sortedOn(2)],
    pixelCount: nPixels,
    volume: -1,
    left: null,
    right: null,
  };

  const volumeOf = (box: Box): number => {
    if (box.volume >= 0) return box.volume;
    if (box.sorted[0].length === 0) {
      box.volume = 0;
    } else {
      const span = (axis: number) =>
        chan[axis][box.sorted[axis][0]] - chan[axis][box.sorted[axis][box.sorted[axis].length - 1]] + 1;
      box.volume = span(0) * span(1) * span(2);
    }
    return box.volume;
  };

  // 3. Median cut.
  const heap = new BoxHeap();
  heap.add(root);
  let wanted = colours;
  cut: while (--wanted) {
    let box: Box | null;
    do {
      box = heap.remove();
      if (!box) break cut;
    } while (volumeOf(box) === 1);
    split(box, chan, counts);
    heap.add(box.left as Box);
    heap.add(box.right as Box);
  }

  // 4. Number the leaf boxes, left before right.
  const boxOf = new Int32Array(n);
  let boxes = 0;
  const annotate = (box: Box): void => {
    if (box.left && box.right) {
      annotate(box.left);
      annotate(box.right);
      return;
    }
    const list = box.sorted[0];
    for (let i = 0; i < list.length; i++) boxOf[list[i]] = boxes;
    if (list.length) boxes++;
  };
  annotate(root);

  // 5-6. Each box's average colour, over pixels.
  const sums = [new Float64Array(boxes), new Float64Array(boxes), new Float64Array(boxes)];
  const boxCount = new Float64Array(boxes);
  for (let c = 0; c < n; c++) {
    const b = boxOf[c];
    sums[0][b] += chan[0][c] * counts[c];
    sums[1][b] += chan[1][c] * counts[c];
    sums[2][b] += chan[2][c] * counts[c];
    boxCount[b] += counts[c];
  }
  const palette = new Uint8Array(boxes * 3);
  for (let b = 0; b < boxes; b++) {
    for (let a = 0; a < 3; a++) palette[b * 3 + a] = Math.trunc(0.5 + sums[a][b] / boxCount[b]);
  }

  // 7. Map each colour to its nearest palette entry, searching the entries in order of distance
  //    from its own box's average and stopping once they are too far to win.
  const dist = new Uint32Array(boxes * boxes);
  const sq = (i: number, j: number) => {
    const dr = palette[i * 3] - palette[j * 3];
    const dg = palette[i * 3 + 1] - palette[j * 3 + 1];
    const db = palette[i * 3 + 2] - palette[j * 3 + 2];
    return dr * dr + dg * dg + db * db;
  };
  for (let i = 0; i < boxes; i++) {
    for (let j = 0; j < i; j++) dist[i * boxes + j] = dist[j * boxes + i] = sq(i, j);
  }
  const order: Int32Array[] = [];
  for (let i = 0; i < boxes; i++) {
    const row = Array.from({ length: boxes }, (_v, j) => j);
    row.sort((a, b) => dist[i * boxes + a] - dist[i * boxes + b] || a - b);
    order.push(Int32Array.from(row));
  }
  const nearest = new Int32Array(n);
  for (let c = 0; c < n; c++) {
    const own = boxOf[c];
    const r = chan[0][c];
    const g = chan[1][c];
    const b = chan[2][c];
    const d0 = (e: number) => {
      const dr = palette[e * 3] - r;
      const dg = palette[e * 3 + 1] - g;
      const db = palette[e * 3 + 2] - b;
      return dr * dr + dg * dg + db * db;
    };
    let best = own;
    let bestDist = d0(own);
    const reach = bestDist * 4;
    const row = order[own];
    for (let j = 0; j < boxes; j++) {
      const e = row[j];
      if (dist[own * boxes + e] > reach) break;
      const dd = d0(e);
      if (dd < bestDist) {
        bestDist = dd;
        best = e;
      }
    }
    nearest[c] = best;
  }
  const indices = new Uint8Array(nPixels);
  for (let i = 0; i < nPixels; i++) indices[i] = nearest[pixelColour[i]];
  return { palette, indices };
}

/** Quant.c `split` + `splitlists`: cut a box in two across its widest (luminance-weighted) axis. */
function split(box: Box, chan: [Int32Array, Int32Array, Int32Array], counts: number[]): void {
  const hi = (axis: number) => chan[axis][box.sorted[axis][0]];
  const lo = (axis: number) => chan[axis][box.sorted[axis][box.sorted[axis].length - 1]];
  const f = [(hi(0) - lo(0)) * 77, (hi(1) - lo(1)) * 150, (hi(2) - lo(2)) * 29];
  let axis = 0;
  let best = f[0];
  for (let i = 1; i < 3; i++) {
    if (best < f[i]) {
      best = f[i];
      axis = i;
    }
  }
  const list = box.sorted[axis];
  const values = chan[axis];
  const right = new Uint8Array(counts.length);
  let left = 0;
  let leftCount = 0;
  let rightCount = 0;
  let i = 0;
  for (; i < list.length; ) {
    left += counts[list[i]];
    leftCount += counts[list[i]];
    i++;
    if (left * 2 > box.pixelCount) break;
  }
  if (i < list.length) {
    const splitValue = values[list[i - 1]];
    for (; i < list.length; i++) {
      if (values[list[i]] !== splitValue) break;
      leftCount += counts[list[i]];
    }
  }
  let nRight = 0;
  for (; i < list.length; i++) {
    right[list[i]] = 1;
    nRight++;
    rightCount += counts[list[i]];
  }
  if (!nRight) {
    const splitValue = values[list[list.length - 1]];
    for (let j = list.length - 1; j >= 0; j--) {
      if (values[list[j]] !== splitValue) break;
      right[list[j]] = 1;
      nRight++;
      leftCount -= counts[list[j]];
      rightCount += counts[list[j]];
    }
  }
  const part = (keepRight: boolean) =>
    box.sorted.map((sorted) => sorted.filter((c) => (right[c] === 1) === keepRight)) as [Int32Array, Int32Array, Int32Array];
  box.left = { sorted: part(false), pixelCount: leftCount, volume: -1, left: null, right: null };
  box.right = { sorted: part(true), pixelCount: rightCount, volume: -1, left: null, right: null };
  box.sorted = [new Int32Array(0), new Int32Array(0), new Int32Array(0)];
}
