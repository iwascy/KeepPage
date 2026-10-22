// Same bookmark mark as apps/web/public/favicon.svg so every surface shares one brand icon.
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg aria-hidden="true" className="brand-mark" height={size} viewBox="0 0 32 32" width={size}>
      <rect fill="#14171c" height="32" rx="9" width="32" />
      <path
        d="M7 4.5A2.5 2.5 0 0 1 9.5 2h5A2.5 2.5 0 0 1 17 4.5V21l-5-3.2L7 21V4.5Z"
        fill="none"
        stroke="#ffffff"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.4"
        transform="translate(6 6) scale(0.8333)"
      />
    </svg>
  );
}
