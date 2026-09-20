// Embedded in newly generated reader documents; original page archives stay intact.
export const READER_THEME_CSS = `
      :root {
        color-scheme: light;
        --bg: #fafbfc;
        --surface: #ffffff;
        --surface-strong: #ffffff;
        --surface-soft: #f7f8fa;
        --text: #202329;
        --muted: #636b76;
        --border: #e4e7eb;
        --accent: #284a78;
        --accent-strong: #203e66;
        --accent-soft: #eef2f8;
        --quote: #f0f3f7;
        --shadow: 0 1px 2px #18202c03;
      }

      a:focus-visible {
        outline: 2px solid #477cb8;
        outline-offset: 3px;
      }

      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { scroll-behavior: auto; }
      }
`;
