import React from 'react';
import rough from 'roughjs';

const roughGenerator = rough.generator();

/**
 * Shared Rough.js vector fallback for Excalidraw scenes.
 *
 * Rendered when the full @excalidraw/excalidraw bundle cannot be loaded —
 * used by BOTH the standalone ExcalidrawViewer and the Excalidraw tiptap
 * editor node (this logic was previously copy-pasted ~150 lines in each).
 */

/** Loose Excalidraw element shape — scenes are untyped JSON on disk. */
export interface RoughFallbackElement {
  id?: string;
  type?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: Array<[number, number]>;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: 'solid' | 'hachure' | 'cross-hatch';
  strokeWidth?: number;
  roughness?: number;
  opacity?: number;
  text?: string;
  fontSize?: number;
}

export interface RoughElementProps {
  el: RoughFallbackElement;
  /** Accent used when the element carries no strokeColor. */
  defaultStroke?: string;
}

export const RoughElement: React.FC<RoughElementProps> = ({ el, defaultStroke = '#00f2fe' }) => {
  const stroke = el.strokeColor || defaultStroke;
  const bg = el.backgroundColor || 'transparent';
  const width = el.width || 0;
  const height = el.height || 0;
  const strokeWidth = el.strokeWidth || 2;
  const roughness = el.roughness !== undefined ? el.roughness : 1.2;
  const opacity = el.opacity ?? 1;

  const roughOptions = {
    stroke,
    fill: bg !== 'transparent' ? bg : undefined,
    strokeWidth,
    roughness,
    bowing: 1.5,
    fillStyle: el.fillStyle || (bg !== 'transparent' ? 'hachure' : undefined),
    hachureAngle: 60,
    hachureGap: 5,
  } as Parameters<typeof roughGenerator.rectangle>[4];

  let drawable: ReturnType<typeof roughGenerator.rectangle> | null = null;

  switch (el.type) {
    case 'rectangle':
      drawable = roughGenerator.rectangle(el.x, el.y, width, height, roughOptions);
      break;
    case 'ellipse':
      drawable = roughGenerator.ellipse(el.x + width / 2, el.y + height / 2, width, height, roughOptions);
      break;
    case 'diamond': {
      const midX = el.x + width / 2;
      const midY = el.y + height / 2;
      drawable = roughGenerator.polygon(
        [
          [midX, el.y],
          [el.x + width, midY],
          [midX, el.y + height],
          [el.x, midY],
        ],
        roughOptions
      );
      break;
    }
    case 'arrow':
    case 'line': {
      const raw = el.points || ([[0, 0], [width, height]] as Array<[number, number]>);
      const pts: [number, number][] = raw.map((pt) => [el.x + pt[0], el.y + pt[1]]);
      drawable = roughGenerator.linearPath(pts, roughOptions);
      break;
    }
    case 'text':
      return (
        <text
          x={el.x}
          y={el.y + (el.fontSize || 16)}
          fill={stroke}
          fontSize={el.fontSize || 16}
          fontFamily="'Segoe UI', system-ui, sans-serif"
          fontWeight={600}
          opacity={opacity}
        >
          {el.text || ''}
        </text>
      );
    default:
      return null;
  }

  if (!drawable) return null;

  const paths = roughGenerator.toPaths(drawable);
  const isArrow = el.type === 'arrow';
  const lastPt: [number, number] =
    el.points && el.points.length ? el.points[el.points.length - 1] : [width, height];

  return (
    <g opacity={opacity}>
      {paths.map((p, idx) => (
        <path
          key={idx}
          d={p.d}
          stroke={p.stroke !== 'none' ? stroke : 'none'}
          strokeWidth={p.strokeWidth || strokeWidth}
          fill={p.fill !== 'none' ? bg : 'none'}
          strokeLinecap="round"
        />
      ))}
      {isArrow && <circle cx={el.x + lastPt[0]} cy={el.y + lastPt[1]} r={4} fill={stroke} />}
    </g>
  );
};

/** Maps a scene's elements into RoughElement instances (React keys handled). */
export const RoughElements: React.FC<{
  elements: RoughFallbackElement[];
  defaultStroke?: string;
}> = ({ elements, defaultStroke }) => (
  <>
    {elements.map((el, i) => (
      <RoughElement key={el.id ?? i} el={el} defaultStroke={defaultStroke} />
    ))}
  </>
);

export default RoughElement;
