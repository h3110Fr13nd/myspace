/**
 * Is the browser rendering without a real GPU?
 *
 * On software rendering (SwiftShader, llvmpipe, "Microsoft Basic Render"),
 * Chromium rasterises *accelerated* canvases in the GPU process and then reads
 * every frame back to the CPU for the software compositor. Traced on a 10k-node
 * canvas viewer that readback (`ProduceCanvasResource`) was ~92% of main-thread
 * time during a pan. A CPU-backed canvas (`willReadFrequently`) skips the round
 * trip entirely. On real GPUs the accelerated path is better, so canvases opt
 * into CPU backing only when this returns true.
 *
 * Probed once per page with a throwaway WebGL context; cached.
 */
let cached: boolean | null = null;

export function isSoftwareRendering(): boolean {
  if (cached !== null) return cached;
  cached = false;
  if (typeof document === 'undefined') return cached;
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) {
      // No WebGL at all usually means GPU features are disabled: treat as software.
      cached = true;
      return cached;
    }
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    cached = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    cached = false;
  }
  return cached;
}

/** 2D context options for a canvas that is repainted every frame. */
export function frameCanvasOptions(): CanvasRenderingContext2DSettings | undefined {
  return isSoftwareRendering() ? { willReadFrequently: true } : undefined;
}
