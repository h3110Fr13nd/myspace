type Mermaid = typeof import('mermaid')['default'];

let mermaidPromise: Promise<Mermaid> | undefined;

/** Load Mermaid only when a diagram is actually rendered in the browser. */
export function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid')
      .then(({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          themeVariables: {
            darkMode: true,
            background: 'transparent',
            primaryColor: '#6366f1',
            primaryTextColor: '#ffffff',
            primaryBorderColor: '#6366f1',
            lineColor: '#00f2fe',
            secondaryColor: '#1e293b',
            tertiaryColor: '#0f172a',
          },
        });
        return mermaid;
      })
      .catch((error) => {
        mermaidPromise = undefined;
        throw error;
      });
  }
  return mermaidPromise;
}
