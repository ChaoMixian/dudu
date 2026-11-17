export type Point = { x: number; y: number };
type Curve = [number, number, number, number, number, number];
type Stroke = { start: [number, number]; curves: Curve[] };
export type HandwritingStroke = { points: Point[]; cumulative: number[]; length: number; path: string };
export type Handwriting = {
  strokes: HandwritingStroke[];
  length: number;
  pen: number;
  bounds: { x: number; y: number; width: number; height: number };
};

export function prepareHandwriting(strokes: Stroke[], pen: number): Handwriting {
  const prepared = strokes.map(({ start, curves }) => {
    const points: Point[] = [{ x: start[0], y: start[1] }];
    let [x, y] = start;
    for (const [ax, ay, bx, by, endX, endY] of curves) {
      const steps = Math.max(8, Math.ceil((Math.hypot(ax - x, ay - y) + Math.hypot(bx - ax, by - ay) + Math.hypot(endX - bx, endY - by)) / 2));
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        const u = 1 - t;
        points.push({
          x: u ** 3 * x + 3 * u * u * t * ax + 3 * u * t * t * bx + t ** 3 * endX,
          y: u ** 3 * y + 3 * u * u * t * ay + 3 * u * t * t * by + t ** 3 * endY,
        });
      }
      x = endX;
      y = endY;
    }
    const cumulative = [0];
    for (let index = 1; index < points.length; index++) {
      cumulative.push(cumulative[index - 1]! + Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y));
    }
    return { points, cumulative, length: cumulative[cumulative.length - 1]!, path: `M ${start.join(' ')} ${curves.map(curve => `C ${curve.join(' ')}`).join(' ')}` };
  });
  const points = prepared.flatMap(stroke => stroke.points);
  const left = Math.min(...points.map(point => point.x)) - pen / 2;
  const top = Math.min(...points.map(point => point.y)) - pen / 2;
  return {
    strokes: prepared,
    length: prepared.reduce((sum, stroke) => sum + stroke.length, 0),
    pen,
    bounds: {
      x: left, y: top,
      width: Math.max(...points.map(point => point.x)) + pen / 2 - left,
      height: Math.max(...points.map(point => point.y)) + pen / 2 - top,
    },
  };
}

/** Each stroke owns its geometry from first ink to the finished word; no reveal mask or font swap. */
export const HANDWRITING = {
  welcome: prepareHandwriting([
    { start: [36, 98], curves: [
      [44, 57, 65, 39, 83, 49], [127, 70, 100, 120, 91, 160],
      [74, 228, 109, 251, 143, 226], [177, 200, 181, 130, 192, 96],
      [186, 139, 172, 204, 194, 226], [227, 258, 269, 219, 280, 158],
      [288, 114, 281, 76, 270, 48], [289, 73, 307, 73, 335, 68],
    ] },
    { start: [292, 235], curves: [
      [347, 237, 404, 224, 421, 182], [440, 135, 392, 109, 371, 153],
      [348, 204, 369, 246, 424, 237], [497, 227, 535, 183, 557, 110],
      [584, 19, 531, 10, 511, 86], [492, 156, 488, 215, 530, 232],
      [562, 246, 600, 224, 616, 179], [630, 134, 664, 115, 695, 144],
      [662, 113, 632, 139, 619, 175], [598, 235, 645, 252, 690, 230],
      [730, 212, 745, 186, 755, 161], [771, 124, 800, 125, 819, 145],
      [856, 182, 822, 246, 783, 233], [748, 222, 744, 182, 761, 153],
      [785, 115, 811, 132, 841, 156], [878, 185, 913, 169, 937, 131],
      [929, 164, 924, 209, 922, 235], [927, 194, 929, 137, 967, 132],
      [1019, 122, 1009, 183, 997, 235], [1007, 181, 1011, 135, 1045, 132],
      [1093, 127, 1080, 181, 1077, 206], [1072, 243, 1108, 245, 1155, 225],
      [1192, 210, 1214, 182, 1218, 161], [1224, 125, 1187, 117, 1166, 150],
      [1142, 194, 1161, 239, 1201, 238], [1227, 239, 1247, 229, 1260, 215],
    ] },
  ], 32),
  dudu: prepareHandwriting([
    { start: [120, 146], curves: [
      [88, 123, 53, 143, 41, 172], [23, 212, 41, 249, 74, 240],
      [110, 231, 120, 178, 128, 127], [134, 90, 139, 56, 143, 36],
      [132, 96, 122, 151, 115, 200], [102, 263, 159, 248, 191, 206],
      [209, 182, 216, 157, 223, 136], [217, 162, 207, 195, 213, 218],
      [219, 247, 248, 248, 270, 231], [294, 211, 296, 161, 305, 136],
      [298, 169, 289, 206, 298, 224], [313, 257, 353, 238, 379, 207],
      [400, 182, 395, 154, 428, 140], [448, 132, 463, 137, 474, 146],
      [440, 122, 407, 144, 395, 173], [377, 213, 394, 250, 429, 240],
      [464, 231, 475, 178, 483, 127], [489, 90, 494, 56, 498, 36],
      [487, 96, 477, 151, 470, 200], [457, 263, 514, 248, 546, 206],
      [564, 182, 571, 157, 578, 136], [572, 162, 562, 195, 568, 218],
      [574, 247, 603, 248, 625, 231], [649, 211, 651, 161, 660, 136],
      [653, 169, 644, 206, 653, 224], [666, 250, 698, 243, 712, 216],
    ] },
  ], 32),
};

export function traceHandwriting(word: Handwriting, progress: number): Point[][] {
  let remaining = word.length * Math.min(1, Math.max(0, progress));
  const visible: Point[][] = [];
  for (const stroke of word.strokes) {
    if (remaining <= 0) break;
    if (remaining >= stroke.length) {
      visible.push(stroke.points);
      remaining -= stroke.length;
      continue;
    }
    const points = [stroke.points[0]!];
    for (let index = 1; index < stroke.points.length; index++) {
      const end = stroke.cumulative[index]!;
      if (end <= remaining) {
        points.push(stroke.points[index]!);
        continue;
      }
      const start = stroke.cumulative[index - 1]!;
      const fraction = (remaining - start) / (end - start);
      const previous = stroke.points[index - 1]!;
      const next = stroke.points[index]!;
      points.push({ x: previous.x + (next.x - previous.x) * fraction, y: previous.y + (next.y - previous.y) * fraction });
      break;
    }
    visible.push(points);
    break;
  }
  return visible;
}
