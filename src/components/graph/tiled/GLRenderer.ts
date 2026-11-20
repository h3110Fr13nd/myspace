/**
 * Tiled graph — WebGL2 renderer.
 *
 * Per tile, node and edge buffers are uploaded once and reused for every frame
 * the tile is on screen. A frame is therefore a handful of uniform updates and
 * two draw calls per visible tile: panning and zooming never touch vertex data,
 * and cost is bounded by the number of tiles on screen (~12 per layer), not by
 * the size of the graph.
 *
 * Nodes are instanced quads shaded as anti-aliased discs (hubs get a bright
 * ring, aggregates a soft glow whose area follows how many items they stand
 * for). Edges are GL_LINES with per-vertex colour, dimmed by on-screen density.
 */
import type { RenderTile } from './prepareTile';
import { visibleEdgePrefix } from './prepareTile';
import type { Camera } from './camera';
import { isSoftwareRendering } from '../../../lib/viewer/gpuTier';
import { MotionRaster } from '../../canvas/core/motionRaster';

export interface DrawItem {
  tile: RenderTile;
  fade: number;
  /** Layer styling: the viewer's private layer is ringed so "mine" reads at a glance. */
  privateLayer: boolean;
  /**
   * Screen rectangle (css px) to clip to. Set when a coarser tile stands in for
   * a finer one that is still streaming, so the stand-in only paints the gap
   * and never doubles up with neighbouring tiles that already arrived.
   */
  clip?: { x: number; y: number; width: number; height: number };
}

export interface FrameInput {
  cam: Camera;
  viewZ: number;
  items: DrawItem[];
  /** Fewer, brighter edges when zoomed in; many faint ones when zoomed out. */
  edgeAlpha: number;
  /** Dim everything except this tile-local node set (hover focus). */
  dimOthers?: boolean;
}

export interface TileRenderer {
  readonly kind: 'webgl2' | 'canvas2d';
  resize(width: number, height: number, dpr: number): void;
  draw(frame: FrameInput): { nodes: number; edges: number };
  release(key: string): void;
  destroy(): void;
}

const NODE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_pos;
layout(location = 2) in float a_radius;
layout(location = 3) in vec4 a_color;
layout(location = 4) in float a_flags;
uniform vec2 u_offset;
uniform float u_k;
uniform vec2 u_view;
uniform float u_alpha;
uniform float u_private;
out vec2 v_local;
out vec4 v_color;
out float v_r;
out float v_flags;
void main() {
  float f = a_flags;
  bool agg = mod(f, 2.0) >= 1.0;
  float r = a_radius * u_k;
  // Real nodes never vanish (1.6px) nor balloon (14px); aggregates may grow
  // larger because they stand for many items.
  r = agg ? clamp(r, 1.2, 22.0) : clamp(r, 1.6, 14.0);
  float pad = 2.0;
  vec2 local = a_corner * (r + pad);
  vec2 screen = a_pos * u_k + u_offset + local;
  vec2 clip = screen / u_view * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_local = local;
  v_color = a_color / 255.0;
  v_color.a *= u_alpha;
  v_r = r;
  v_flags = f + u_private * 64.0;
}`;

const NODE_FS = `#version 300 es
precision highp float;
in vec2 v_local;
in vec4 v_color;
in float v_r;
in float v_flags;
out vec4 outColor;
void main() {
  float d = length(v_local);
  float cover = clamp(v_r - d + 0.5, 0.0, 1.0);
  bool agg = mod(v_flags, 2.0) >= 1.0;
  bool hub = mod(floor(v_flags / 2.0), 2.0) >= 1.0;
  bool mine = v_flags >= 64.0;
  vec3 col = v_color.rgb;
  float a = v_color.a;
  if (agg) {
    // Soft glow: dense regions read as brighter blobs, not hard discs.
    float glow = 1.0 - smoothstep(0.0, v_r, d);
    a *= cover * (0.25 + 0.75 * glow);
  } else {
    float ring = smoothstep(v_r - 1.8, v_r - 0.7, d);
    vec3 ringCol = mine ? vec3(0.98, 0.82, 0.3) : (hub ? vec3(1.0) : min(col * 1.4 + 0.12, vec3(1.0)));
    col = mix(col, ringCol, ring * (hub || mine ? 0.95 : 0.6));
    a *= cover;
  }
  if (a <= 0.003) discard;
  outColor = vec4(col * a, a);
}`;

const EDGE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec4 a_color;
layout(location = 2) in float a_len;
uniform vec2 u_offset;
uniform float u_k;
uniform vec2 u_view;
uniform float u_alpha;
out vec4 v_color;
void main() {
  vec2 screen = a_pos * u_k + u_offset;
  vec2 clip = screen / u_view * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_color = a_color / 255.0;
  // Length fading: an edge spanning more than about half the screen fades
  // toward a haze, so local structure stays crisp while long-range links
  // remain visible as context.
  float lenPx = a_len * u_k;
  float reach = 0.5 * max(u_view.x, u_view.y);
  v_color.a *= u_alpha * clamp(reach / max(lenPx, 1.0), 0.12, 1.0);
}`;

const EDGE_FS = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 outColor;
void main() {
  outColor = vec4(v_color.rgb * v_color.a, v_color.a);
}`;

interface GpuTile {
  nodeVao: WebGLVertexArrayObject;
  edgeVao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  nodes: number;
  bytes: number;
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const make = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(`shader: ${gl.getShaderInfoLog(sh)}`);
    }
    return sh;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(prog)}`);
  return prog;
}

export class GLRenderer implements TileRenderer {
  readonly kind = 'webgl2' as const;
  private gl: WebGL2RenderingContext;
  private nodeProg: WebGLProgram;
  private edgeProg: WebGLProgram;
  private quad: WebGLBuffer;
  private gpu = new Map<string, GpuTile>();
  private width = 1;
  private height = 1;
  private dpr = 1;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private ue: Record<string, WebGLUniformLocation | null> = {};

  /**
   * A WebGL2 renderer, or null when WebGL2 is missing *or software-emulated*.
   *
   * `failIfMajorPerformanceCaveat` makes the browser refuse a context that
   * would be slow — software GL (SwiftShader), or GPU contexts on a software
   * compositor, where every frame is read back from the GPU to the CPU
   * (`ReadPixels`) before it can be composited. Traced in a GPU-less
   * Chromium, that readback was ~87% of main-thread time while the renderer's
   * own JavaScript was ~2%. The Canvas 2D fallback avoids the round trip.
   * `?graphRenderer=webgl` forces WebGL anyway (diagnostics).
   */
  static create(canvas: HTMLCanvasElement): GLRenderer | null {
    const force =
      typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('graphRenderer') === 'webgl';
    // Probe on a throwaway canvas: once a canvas has held a WebGL context it can
    // never take a 2D one, so deciding on the real canvas would leave the 2D
    // fallback with no context at all.
    if (!force && isSoftwareRendering()) return null;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: !force,
    });
    if (!gl) return null;
    try {
      return new GLRenderer(gl);
    } catch {
      return null;
    }
  }

  private constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.nodeProg = compile(gl, NODE_VS, NODE_FS);
    this.edgeProg = compile(gl, EDGE_VS, EDGE_FS);
    for (const n of ['u_offset', 'u_k', 'u_view', 'u_alpha', 'u_private']) this.u[n] = gl.getUniformLocation(this.nodeProg, n);
    for (const n of ['u_offset', 'u_k', 'u_view', 'u_alpha']) this.ue[n] = gl.getUniformLocation(this.edgeProg, n);
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = dpr;
    const canvas = this.gl.canvas as HTMLCanvasElement;
    const w = Math.round(this.width * dpr);
    const h = Math.round(this.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  private upload(tile: RenderTile): GpuTile {
    const gl = this.gl;
    const buf = (data: ArrayBufferView) => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return b;
    };
    const nodeVao = gl.createVertexArray()!;
    gl.bindVertexArray(nodeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const pos = buf(tile.nodePos);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    const rad = buf(tile.nodeRadius);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);
    const col = buf(tile.nodeColor);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, false, 0, 0);
    gl.vertexAttribDivisor(3, 1);
    const flg = buf(tile.nodeFlags);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(4, 1);

    const edgeVao = gl.createVertexArray()!;
    gl.bindVertexArray(edgeVao);
    const epos = buf(tile.edgePos);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ecol = buf(tile.edgeColor);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, false, 0, 0);
    const elen = buf(tile.edgeLen);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const bytes =
      tile.nodePos.byteLength + tile.nodeRadius.byteLength + tile.nodeColor.byteLength +
      tile.nodeFlags.byteLength + tile.edgePos.byteLength + tile.edgeColor.byteLength + tile.edgeLen.byteLength;
    const g: GpuTile = { nodeVao, edgeVao, buffers: [pos, rad, col, flg, epos, ecol, elen], nodes: tile.gid.length, bytes };
    this.gpu.set(tile.key, g);
    return g;
  }

  draw(frame: FrameInput): { nodes: number; edges: number } {
    const gl = this.gl;
    gl.viewport(0, 0, Math.round(this.width * this.dpr), Math.round(this.height * this.dpr));
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const { cam } = frame;
    let nodes = 0;
    let edges = 0;

    // Float64 on the CPU: screen position of each tile's origin.
    const offset = (t: RenderTile): [number, number] => [t.worldX * cam.k + cam.x, t.worldY * cam.k + cam.y];

    gl.useProgram(this.edgeProg);
    gl.uniform1f(this.ue.u_k, cam.k);
    gl.uniform2f(this.ue.u_view, this.width, this.height);
    for (const item of frame.items) {
      const count = visibleEdgePrefix(item.tile, frame.viewZ);
      if (count === 0) continue;
      const g = this.gpu.get(item.tile.key) ?? this.upload(item.tile);
      const [ox, oy] = offset(item.tile);
      this.scissor(item);
      gl.uniform2f(this.ue.u_offset, ox, oy);
      gl.uniform1f(this.ue.u_alpha, frame.edgeAlpha * item.fade * (frame.dimOthers ? 0.35 : 1));
      gl.bindVertexArray(g.edgeVao);
      gl.drawArrays(gl.LINES, 0, count * 2);
      edges += count;
    }
    gl.disable(gl.SCISSOR_TEST);

    gl.useProgram(this.nodeProg);
    gl.uniform1f(this.u.u_k, cam.k);
    gl.uniform2f(this.u.u_view, this.width, this.height);
    for (const item of frame.items) {
      const n = item.tile.gid.length;
      if (n === 0) continue;
      const g = this.gpu.get(item.tile.key) ?? this.upload(item.tile);
      const [ox, oy] = offset(item.tile);
      this.scissor(item);
      gl.uniform2f(this.u.u_offset, ox, oy);
      gl.uniform1f(this.u.u_alpha, item.fade * (frame.dimOthers ? 0.45 : 1));
      gl.uniform1f(this.u.u_private, item.privateLayer ? 1 : 0);
      gl.bindVertexArray(g.nodeVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      nodes += n;
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(null);
    return { nodes, edges };
  }

  private scissor(item: DrawItem): void {
    const gl = this.gl;
    if (!item.clip) {
      gl.disable(gl.SCISSOR_TEST);
      return;
    }
    const d = this.dpr;
    const c = item.clip;
    const x = Math.max(0, Math.floor(c.x * d));
    const yTop = Math.max(0, Math.floor(c.y * d));
    const w = Math.max(0, Math.ceil((c.x + c.width) * d) - x);
    const h = Math.max(0, Math.ceil((c.y + c.height) * d) - yTop);
    const H = Math.round(this.height * d);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, Math.max(0, H - yTop - h), w, h);
  }

  release(key: string): void {
    const g = this.gpu.get(key);
    if (!g) return;
    const gl = this.gl;
    gl.deleteVertexArray(g.nodeVao);
    gl.deleteVertexArray(g.edgeVao);
    for (const b of g.buffers) gl.deleteBuffer(b);
    this.gpu.delete(key);
  }

  gpuBytes(): number {
    let sum = 0;
    for (const g of this.gpu.values()) sum += g.bytes;
    return sum;
  }

  destroy(): void {
    for (const k of [...this.gpu.keys()]) this.release(k);
    const gl = this.gl;
    gl.deleteBuffer(this.quad);
    gl.deleteProgram(this.nodeProg);
    gl.deleteProgram(this.edgeProg);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/**
 * Canvas 2D fallback for browsers without WebGL2. Same inputs; tiles bound the
 * work per frame, so it stays usable, just with a lower frame-rate ceiling.
 */
export class Canvas2DRenderer implements TileRenderer {
  readonly kind = 'canvas2d' as const;
  private ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private dpr = 1;
  /**
   * Motion impostor: while the camera moves over an unchanged set of tiles,
   * blit a snapshot (with overscan) instead of re-rasterising every edge. A
   * CPU rasteriser pays per edge pixel per frame; this pays one drawImage.
   */
  private raster = new MotionRaster({
    margin: 0.25,
    settleMs: 140,
    minItems: 4000,
    contextOptions: { alpha: true, willReadFrequently: true },
  });
  private lastSig = '';
  private lastCounts = { nodes: 0, edges: 0 };

  /** Called once the camera settles so the host can paint at full quality. */
  onSettle: () => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    // CPU-backed: this renderer is chosen precisely when there is no real
    // GPU, and an accelerated 2D canvas would again be rasterised in the GPU
    // process and read back every frame.
    const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
    if (!ctx) throw new Error('Canvas2DRenderer: no 2D context available for this canvas');
    this.ctx = ctx;
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.raster.invalidate();
  }

  draw(frame: FrameInput): { nodes: number; edges: number } {
    // Content signature: which tiles (and stand-ins), their fade, the level and
    // the edge density. Any change forces a full paint; camera-only changes
    // may be served from the snapshot.
    let sig = `${frame.viewZ}|${frame.edgeAlpha.toFixed(3)}|${frame.dimOthers ? 1 : 0}`;
    let work = 0;
    for (const it of frame.items) {
      sig += `|${it.tile.key}${it.clip ? '#c' : ''}${it.privateLayer ? 'p' : ''}${it.fade.toFixed(2)}`;
      work += it.tile.gid.length + visibleEdgePrefix(it.tile, frame.viewZ);
    }
    if (sig !== this.lastSig) {
      this.raster.invalidate();
      this.lastSig = sig;
    }
    const kind = this.raster.frame(
      this.ctx,
      frame.cam,
      this.width,
      this.height,
      this.dpr,
      work,
      (ctx, cam, W, H) => {
        this.lastCounts = this.paint(ctx, frame, cam, W, H);
      },
      () => this.onSettle()
    );
    void kind;
    return this.lastCounts;
  }

  /**
   * Full paint of `frame` into `ctx` for camera `cam` (same zoom as
   * `frame.cam`, possibly shifted for the snapshot's overscan) over a `W x H`
   * css-px surface.
   */
  private paint(
    ctx: CanvasRenderingContext2D,
    frame: FrameInput,
    cam: Camera,
    W: number,
    H: number
  ): { nodes: number; edges: number } {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    let nodes = 0;
    let edges = 0;
    const reach = 0.5 * Math.max(this.width, this.height);
    // Stand-in clip rects are in frame.cam screen space.
    const cdx = cam.x - frame.cam.x;
    const cdy = cam.y - frame.cam.y;

    const clipTo = (item: DrawItem) => {
      ctx.restore();
      ctx.save();
      if (item.clip) {
        ctx.beginPath();
        ctx.rect(item.clip.x + cdx, item.clip.y + cdy, item.clip.width, item.clip.height);
        ctx.clip();
      }
    };
    ctx.save();

    // Edges: one path per (colour, alpha level) per tile — a handful of
    // strokes instead of one per edge. Same length fading as the GL shader.
    // Exactly one device pixel: Skia's hairline fast path, instead of the
    // general stroker (measured ~4x cheaper for long crossing lines).
    ctx.lineWidth = 1 / this.dpr;
    const LEVELS = 12;
    for (const item of frame.items) {
      const t = item.tile;
      const count = visibleEdgePrefix(t, frame.viewZ);
      if (!count) continue;
      clipTo(item);
      const ox = t.worldX * cam.k + cam.x;
      const oy = t.worldY * cam.k + cam.y;
      const paths = new Map<number, Path2D>();
      const colours = new Map<number, string>();
      for (let e = 0; e < count; e++) {
        const x1 = t.edgePos[e * 4] * cam.k + ox;
        const y1 = t.edgePos[e * 4 + 1] * cam.k + oy;
        const x2 = t.edgePos[e * 4 + 2] * cam.k + ox;
        const y2 = t.edgePos[e * 4 + 3] * cam.k + oy;
        if ((x1 < 0 && x2 < 0) || (y1 < 0 && y2 < 0) || (x1 > W && x2 > W) || (y1 > H && y2 > H)) continue;
        const lenFade = Math.min(1, Math.max(0.12, reach / Math.max(1, t.edgeLen[e * 2] * cam.k)));
        const a = (t.edgeColor[e * 8 + 3] / 255) * frame.edgeAlpha * item.fade * lenFade;
        const level = Math.min(LEVELS, Math.max(1, Math.round(a * LEVELS * 1.5)));
        const rgb = (t.edgeColor[e * 8] << 16) | (t.edgeColor[e * 8 + 1] << 8) | t.edgeColor[e * 8 + 2];
        const key = rgb * 16 + level;
        let p = paths.get(key);
        if (!p) {
          p = new Path2D();
          paths.set(key, p);
          colours.set(key, `rgba(${rgb >> 16},${(rgb >> 8) & 255},${rgb & 255},${(level / LEVELS / 1.5).toFixed(3)})`);
        }
        p.moveTo(x1, y1);
        p.lineTo(x2, y2);
        edges++;
      }
      for (const [key, p] of paths) {
        ctx.strokeStyle = colours.get(key)!;
        ctx.stroke(p);
      }
    }

    // Nodes: one fill per (colour, alpha) per tile; rings as two stroke paths.
    for (const item of frame.items) {
      const t = item.tile;
      clipTo(item);
      const ox = t.worldX * cam.k + cam.x;
      const oy = t.worldY * cam.k + cam.y;
      const n = t.gid.length;
      const fills = new Map<number, Path2D>();
      const hubRing = new Path2D();
      const mineRing = new Path2D();
      let rings = 0;
      for (let i = 0; i < n; i++) {
        const agg = (t.flags[i] & 1) !== 0;
        let r = t.nodeRadius[i] * cam.k;
        r = agg ? Math.min(22, Math.max(1.2, r)) : Math.min(14, Math.max(1.6, r));
        const sx = t.nodePos[i * 2] * cam.k + ox;
        const sy = t.nodePos[i * 2 + 1] * cam.k + oy;
        if (sx < -r || sy < -r || sx > W + r || sy > H + r) continue;
        const alphaLevel = Math.max(1, Math.round((t.nodeColor[i * 4 + 3] / 255) * item.fade * 8));
        const rgb = (t.nodeColor[i * 4] << 16) | (t.nodeColor[i * 4 + 1] << 8) | t.nodeColor[i * 4 + 2];
        const key = rgb * 16 + alphaLevel;
        let p = fills.get(key);
        if (!p) fills.set(key, (p = new Path2D()));
        p.moveTo(sx + r, sy);
        p.arc(sx, sy, r, 0, Math.PI * 2);
        if (!agg && (item.privateLayer || t.flags[i] & 2) && r >= 2.5) {
          const ring = item.privateLayer ? mineRing : hubRing;
          ring.moveTo(sx + r, sy);
          ring.arc(sx, sy, r, 0, Math.PI * 2);
          rings++;
        }
        nodes++;
      }
      for (const [key, p] of fills) {
        const rgb = Math.floor(key / 16);
        ctx.fillStyle = `rgba(${rgb >> 16},${(rgb >> 8) & 255},${rgb & 255},${((key % 16) / 8).toFixed(3)})`;
        ctx.fill(p);
      }
      if (rings) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.stroke(hubRing);
        ctx.strokeStyle = 'rgba(250,209,77,0.95)';
        ctx.stroke(mineRing);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    return { nodes, edges };
  }

  release(): void {}
  destroy(): void {
    this.raster.dispose();
  }
}
