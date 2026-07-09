import type { SVGProps } from "react";

export type IconName =
  | "add"
  | "arrow_back"
  | "arrow_outward"
  | "book_open"
  | "bookmark"
  | "bookmarks"
  | "check_circle"
  | "close"
  | "delete"
  | "description"
  | "download"
  | "file_archive"
  | "folder_open"
  | "grid_view"
  | "history"
  | "inbox"
  | "info"
  | "inventory_2"
  | "keyboard_arrow_right"
  | "link"
  | "link_off"
  | "lock"
  | "lock_open"
  | "logout"
  | "menu"
  | "more_horiz"
  | "more_vert"
  | "open_in_new"
  | "public"
  | "refresh"
  | "rocket_launch"
  | "schedule"
  | "search"
  | "settings"
  | "share"
  | "star"
  | "tune"
  | "view_list"
  | "vpn_key"
  | "hourglass_empty";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children" | "name"> & {
  name: IconName;
};

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  strokeWidth: 2,
} as const;

export function Icon({ name, className, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={["app-icon", className].filter(Boolean).join(" ")}
      focusable="false"
      role="img"
      viewBox="0 0 24 24"
      {...props}
    >
      {renderIcon(name)}
    </svg>
  );
}

function renderIcon(name: IconName) {
  switch (name) {
    case "add":
      return <path {...strokeProps} d="M12 5v14M5 12h14" />;
    case "arrow_back":
      return <path {...strokeProps} d="M19 12H5m7-7-7 7 7 7" />;
    case "arrow_outward":
      return <path {...strokeProps} d="M7 17 17 7M9 7h8v8" />;
    case "book_open":
      return (
        <>
          <path {...strokeProps} d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z" />
          <path {...strokeProps} d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5A2.5 2.5 0 0 1 20 21V5.5Z" />
        </>
      );
    case "bookmark":
      return (
        <path
          {...strokeProps}
          d="M7 4.5A2.5 2.5 0 0 1 9.5 2h5A2.5 2.5 0 0 1 17 4.5V21l-5-3.2L7 21V4.5Z"
        />
      );
    case "bookmarks":
      return (
        <>
          <path {...strokeProps} d="M8 5.5A2.5 2.5 0 0 1 10.5 3H17v15l-4.5-2.8L8 18V5.5Z" />
          <path {...strokeProps} d="M6 6v15l4.5-2.8" />
        </>
      );
    case "check_circle":
      return (
        <>
          <circle {...strokeProps} cx="12" cy="12" r="9" />
          <path {...strokeProps} d="m8.5 12.5 2.5 2.5 4.5-5" />
        </>
      );
    case "close":
      return <path {...strokeProps} d="m6 6 12 12M18 6 6 18" />;
    case "delete":
      return (
        <>
          <path {...strokeProps} d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14" />
          <path {...strokeProps} d="M9 7V4h6v3" />
        </>
      );
    case "description":
      return (
        <>
          <path {...strokeProps} d="M7 3h7l4 4v14H7V3Z" />
          <path {...strokeProps} d="M14 3v5h5M9 13h6M9 17h6" />
        </>
      );
    case "download":
      return <path {...strokeProps} d="M12 4v10m0 0 4-4m-4 4-4-4M5 20h14" />;
    case "file_archive":
      return (
        <>
          <path {...strokeProps} d="M7 3h7l4 4v14H7V3Z" />
          <path {...strokeProps} d="M14 3v5h5M10 12h4M10 16h4M10 8h1" />
        </>
      );
    case "folder_open":
      return (
        <path
          {...strokeProps}
          d="M3 18.5 5 8h5l2 2h7.5a1.5 1.5 0 0 1 1.47 1.8l-1.25 6.4A2.25 2.25 0 0 1 17.5 20H4.5A1.5 1.5 0 0 1 3 18.5ZM5 8V6.5A2.5 2.5 0 0 1 7.5 4H10l2 2h5.5A2.5 2.5 0 0 1 20 8.5V10"
        />
      );
    case "grid_view":
      return (
        <>
          <rect {...strokeProps} x="4" y="4" width="7" height="7" rx="1.2" />
          <rect {...strokeProps} x="13" y="4" width="7" height="7" rx="1.2" />
          <rect {...strokeProps} x="4" y="13" width="7" height="7" rx="1.2" />
          <rect {...strokeProps} x="13" y="13" width="7" height="7" rx="1.2" />
        </>
      );
    case "history":
      return <path {...strokeProps} d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2" />;
    case "hourglass_empty":
      return <path {...strokeProps} d="M6 3h12M6 21h12M8 3v3l4 4 4-4V3M8 21v-3l4-4 4 4v3" />;
    case "inbox":
      return (
        <>
          <path {...strokeProps} d="M4 13h4l1.5 2h5L16 13h4v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6Z" />
          <path {...strokeProps} d="M4 13 7 4h10l3 9" />
        </>
      );
    case "info":
      return (
        <>
          <circle {...strokeProps} cx="12" cy="12" r="9" />
          <path {...strokeProps} d="M12 11v5M12 8h.01" />
        </>
      );
    case "inventory_2":
      return (
        <>
          <path {...strokeProps} d="M4 8h16v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" />
          <path {...strokeProps} d="M4 8 6.5 4h11L20 8M10 12h4" />
        </>
      );
    case "keyboard_arrow_right":
      return <path {...strokeProps} d="m9 5 7 7-7 7" />;
    case "link":
      return (
        <>
          <path {...strokeProps} d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
          <path {...strokeProps} d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1" />
        </>
      );
    case "link_off":
      return (
        <>
          <path {...strokeProps} d="m4 4 16 16" />
          <path {...strokeProps} d="M10 13a5 5 0 0 0 6 0l1-1M8 16l-1 1a5 5 0 0 0 7 0" />
          <path {...strokeProps} d="M14 11a5 5 0 0 0-3-3M17 7l1-1a5 5 0 0 0-7 0" />
        </>
      );
    case "lock":
      return (
        <>
          <rect {...strokeProps} x="5" y="10" width="14" height="10" rx="2" />
          <path {...strokeProps} d="M8 10V7a4 4 0 0 1 8 0v3" />
        </>
      );
    case "lock_open":
      return (
        <>
          <rect {...strokeProps} x="5" y="10" width="14" height="10" rx="2" />
          <path {...strokeProps} d="M8 10V7a4 4 0 0 1 7.5-2" />
        </>
      );
    case "logout":
      return (
        <>
          <path {...strokeProps} d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
          <path {...strokeProps} d="M15 8l4 4-4 4M19 12H9" />
        </>
      );
    case "menu":
      return <path {...strokeProps} d="M4 7h16M4 12h16M4 17h16" />;
    case "more_horiz":
      return (
        <>
          <circle cx="6" cy="12" r="1.5" fill="currentColor" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          <circle cx="18" cy="12" r="1.5" fill="currentColor" />
        </>
      );
    case "more_vert":
      return (
        <>
          <circle cx="12" cy="6" r="1.5" fill="currentColor" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          <circle cx="12" cy="18" r="1.5" fill="currentColor" />
        </>
      );
    case "open_in_new":
      return (
        <>
          <path {...strokeProps} d="M14 4h6v6M13 11l7-7" />
          <path {...strokeProps} d="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
        </>
      );
    case "public":
      return (
        <>
          <circle {...strokeProps} cx="12" cy="12" r="9" />
          <path {...strokeProps} d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </>
      );
    case "refresh":
      return <path {...strokeProps} d="M20 6v5h-5M4 18v-5h5M18.5 9A7 7 0 0 0 6 6.8M5.5 15A7 7 0 0 0 18 17.2" />;
    case "rocket_launch":
      return (
        <>
          <path {...strokeProps} d="M5 19c2-1 4-4 4-4l2 2s-3 2-4 4c-1 0-2-1-2-2Z" />
          <path {...strokeProps} d="M14 4c3 1 6 4 7 7-3 1-6 4-8 6l-3-3c2-2 5-5 6-8Z" />
          <path {...strokeProps} d="M9 15 7 17" />
        </>
      );
    case "schedule":
      return (
        <>
          <circle {...strokeProps} cx="12" cy="12" r="9" />
          <path {...strokeProps} d="M12 7v5l3 2" />
        </>
      );
    case "search":
      return (
        <>
          <circle {...strokeProps} cx="11" cy="11" r="6" />
          <path {...strokeProps} d="m16 16 4 4" />
        </>
      );
    case "settings":
      return (
        <>
          <circle {...strokeProps} cx="12" cy="12" r="3" />
          <path
            {...strokeProps}
            d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V20.3h-3v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 5 15a1.7 1.7 0 0 0-1.55-1H3.36v-3h.09A1.7 1.7 0 0 0 5 10a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.12-2.12.06.06A1.7 1.7 0 0 0 8.66 6.3a1.7 1.7 0 0 0 1-1.55V4.66h3v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06A1.7 1.7 0 0 0 19 10a1.7 1.7 0 0 0 1.55 1h.09v3h-.09A1.7 1.7 0 0 0 19.4 15Z"
          />
        </>
      );
    case "share":
      return (
        <>
          <circle {...strokeProps} cx="18" cy="5" r="2.5" />
          <circle {...strokeProps} cx="6" cy="12" r="2.5" />
          <circle {...strokeProps} cx="18" cy="19" r="2.5" />
          <path {...strokeProps} d="m8.2 13.2 7.5 4.3M15.7 6.5l-7.5 4.3" />
        </>
      );
    case "star":
      return (
        <path
          {...strokeProps}
          d="m12 3 2.7 5.47 6.03.88-4.36 4.25 1.03 6-5.4-2.84L6.6 19.6l1.03-6-4.36-4.25 6.03-.88L12 3Z"
        />
      );
    case "tune":
      return (
        <>
          <path {...strokeProps} d="M4 7h10M18 7h2M4 17h2M10 17h10M4 12h4M12 12h8" />
          <circle {...strokeProps} cx="16" cy="7" r="2" />
          <circle {...strokeProps} cx="8" cy="17" r="2" />
          <circle {...strokeProps} cx="10" cy="12" r="2" />
        </>
      );
    case "view_list":
      return (
        <>
          <path {...strokeProps} d="M8 6h12M8 12h12M8 18h12" />
          <circle cx="4.5" cy="6" r="1.2" fill="currentColor" />
          <circle cx="4.5" cy="12" r="1.2" fill="currentColor" />
          <circle cx="4.5" cy="18" r="1.2" fill="currentColor" />
        </>
      );
    case "vpn_key":
      return (
        <>
          <circle {...strokeProps} cx="7.5" cy="12" r="3.5" />
          <path {...strokeProps} d="M11 12h9M16 12v3M19 12v2" />
        </>
      );
  }
}
