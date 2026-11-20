/**
 * Tiled graph — label placement.
 *
 * Greedy, heaviest first, on a coarse occupancy grid: a label is drawn only if
 * its box does not overlap one already placed. O(candidates) per frame with a
 * hard cap. During motion the cap is lowered; labels fill back in once the
 * camera settles, which keeps interaction frames cheap and reads as calm.
 *
 * Each label is rendered once into a small sprite (text + halo) and blitted on
 * later frames. Stroking glyph outlines for the halo is the most expensive
 * thing a 2D canvas draws — traced at ~2 ms per label in software
 * rasterisation, so 150 labels cost ~300 ms per frame — while blitting a cached
 * sprite is a memcpy. Sprites live in a byte-bounded LRU.
 */

export interface LabelCandidate {
  sx: number;
  sy: number;
  r: number;
  text: string;
  /** Higher draws first. */
  priority: number;
  hub: boolean;
  mine: boolean;
  /** Explicit fill colour, overriding the palette (e.g. "read" notes). */
  color?: string;
}

const CELL = 12;

/** Label colours, resolved from design tokens by the view (theme-aware). */
export interface LabelPalette {
  text: string;
  hub: string;
  mine: string;
  halo: string;
}

interface Sprite {
  canvas: HTMLCanvasElement;
  /** CSS px. */
  width: number;
  height: number;
  bytes: number;
}

const SPRITE_PAD = 4;
const SPRITE_H = 18;
const SPRITE_BUDGET_BYTES = 12 * 1024 * 1024;

export class LabelLayer {
  private widths = new Map<string, number>();
  private sprites = new Map<string, Sprite>();
  private spriteBytes = 0;
  private occupied = new Uint8Array(0);
  private cols = 0;
  private rows = 0;

  constructor(private font = '500 11px Inter, system-ui, -apple-system, sans-serif') {}

  private width(ctx: CanvasRenderingContext2D, text: string): number {
    let w = this.widths.get(text);
    if (w === undefined) {
      w = ctx.measureText(text).width;
      if (this.widths.size > 20000) this.widths.clear();
      this.widths.set(text, w);
    }
    return w;
  }

  /** Cached (text + halo) bitmap for a label, created on first use. */
  private sprite(text: string, fill: string, halo: string, textWidth: number, dpr: number): Sprite | null {
    const key = `${dpr}|${fill}|${halo}|${text}`;
    const hit = this.sprites.get(key);
    if (hit) {
      // LRU: move to the most-recent end.
      this.sprites.delete(key);
      this.sprites.set(key, hit);
      return hit;
    }
    if (typeof document === 'undefined') return null;
    const width = Math.ceil(textWidth + SPRITE_PAD * 2);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(SPRITE_H * dpr);
    const c = canvas.getContext('2d');
    if (!c) return null;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.font = this.font;
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.lineJoin = 'round';
    c.lineWidth = 3;
    c.strokeStyle = halo;
    c.strokeText(text, SPRITE_PAD, SPRITE_H / 2);
    c.fillStyle = fill;
    c.fillText(text, SPRITE_PAD, SPRITE_H / 2);
    const sprite: Sprite = { canvas, width, height: SPRITE_H, bytes: canvas.width * canvas.height * 4 };
    this.sprites.set(key, sprite);
    this.spriteBytes += sprite.bytes;
    while (this.spriteBytes > SPRITE_BUDGET_BYTES && this.sprites.size) {
      const [oldKey, old] = this.sprites.entries().next().value as [string, Sprite];
      this.sprites.delete(oldKey);
      this.spriteBytes -= old.bytes;
    }
    return sprite;
  }

  /** Place and draw labels. Returns how many were drawn. */
  draw(
    ctx: CanvasRenderingContext2D,
    candidates: LabelCandidate[],
    view: { width: number; height: number },
    max: number,
    palette: LabelPalette,
    alpha = 1
  ): number {
    this.cols = Math.ceil(view.width / CELL) + 1;
    this.rows = Math.ceil(view.height / CELL) + 1;
    const size = this.cols * this.rows;
    if (this.occupied.length < size) this.occupied = new Uint8Array(size);
    else this.occupied.fill(0, 0, size);

    candidates.sort((a, b) => b.priority - a.priority);
    ctx.font = this.font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    const dpr = ctx.getTransform().a || 1;
    let drawn = 0;
    for (const c of candidates) {
      if (drawn >= max) break;
      const text = c.text.length > 32 ? `${c.text.slice(0, 30)}…` : c.text;
      const w = this.width(ctx, text);
      const x0 = c.sx + c.r + 4;
      const y0 = c.sy - 7;
      const x1 = x0 + w;
      const y1 = y0 + 14;
      if (x1 < 0 || y1 < 0 || x0 > view.width || y0 > view.height) continue;
      const cx0 = Math.max(0, Math.floor(x0 / CELL));
      const cy0 = Math.max(0, Math.floor(y0 / CELL));
      const cx1 = Math.min(this.cols - 1, Math.floor(x1 / CELL));
      const cy1 = Math.min(this.rows - 1, Math.floor(y1 / CELL));
      let free = true;
      for (let gy = cy0; gy <= cy1 && free; gy++) {
        for (let gx = cx0; gx <= cx1; gx++) {
          if (this.occupied[gy * this.cols + gx]) {
            free = false;
            break;
          }
        }
      }
      if (!free) continue;
      for (let gy = cy0; gy <= cy1; gy++) for (let gx = cx0; gx <= cx1; gx++) this.occupied[gy * this.cols + gx] = 1;
      ctx.globalAlpha = alpha;
      const fill = c.color ?? (c.mine ? palette.mine : c.hub ? palette.hub : palette.text);
      const sprite = this.sprite(text, fill, palette.halo, w, dpr);
      if (sprite) {
        ctx.drawImage(sprite.canvas, x0 - SPRITE_PAD, c.sy - SPRITE_H / 2, sprite.width, sprite.height);
      } else {
        ctx.lineWidth = 3;
        ctx.strokeStyle = palette.halo;
        ctx.strokeText(text, x0, c.sy);
        ctx.fillStyle = fill;
        ctx.fillText(text, x0, c.sy);
      }
      drawn++;
    }
    ctx.globalAlpha = 1;
    return drawn;
  }
}
