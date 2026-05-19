import { useId } from "react";

type DefaultSiteIconProps = {
  className?: string;
};

export function DefaultSiteIcon({ className = "default-site-icon" }: DefaultSiteIconProps) {
  const backgroundGradientId = useId();
  const iconGradientId = useId();

  return (
    <svg
      className={className}
      aria-hidden="true"
      focusable="false"
      role="img"
      viewBox="0 0 128 128"
    >
      <defs>
        <linearGradient id={backgroundGradientId} x1="20" y1="10" x2="108" y2="118" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fbfbfc" />
          <stop offset="0.54" stopColor="#f4f5f6" />
          <stop offset="1" stopColor="#edeff1" />
        </linearGradient>
        <linearGradient id={iconGradientId} x1="35" y1="34" x2="94" y2="96" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#9ba0a6" />
          <stop offset="1" stopColor="#858b92" />
        </linearGradient>
      </defs>
      <rect
        x="7"
        y="7"
        width="114"
        height="114"
        rx="17"
        fill={`url(#${backgroundGradientId})`}
      />
      <circle
        cx="64"
        cy="64"
        r="30"
        fill="none"
        stroke={`url(#${iconGradientId})`}
        strokeWidth="5.5"
      />
      <path
        d="M35 64h58M64 34v60M41.5 46.5c6.2 5.1 13.6 7.6 22.5 7.6s16.3-2.5 22.5-7.6M41.5 81.5c6.2-5.1 13.6-7.6 22.5-7.6s16.3 2.5 22.5 7.6"
        fill="none"
        stroke={`url(#${iconGradientId})`}
        strokeLinecap="round"
        strokeWidth="5.5"
      />
      <path
        d="M64 34c-9.6 8.4-14.4 18.4-14.4 30S54.4 85.6 64 94M64 34c9.6 8.4 14.4 18.4 14.4 30S73.6 85.6 64 94"
        fill="none"
        stroke={`url(#${iconGradientId})`}
        strokeLinecap="round"
        strokeWidth="5.5"
      />
    </svg>
  );
}
