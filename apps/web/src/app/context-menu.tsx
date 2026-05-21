import {
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  Bookmark,
  Folder,
  Tag,
} from "@keeppage/domain";
import { clampContextMenuPosition } from "./browser-utils";

export type ContextMenuState =
  | { kind: "closed" }
  | { kind: "bookmark"; bookmark: Bookmark; x: number; y: number }
  | { kind: "folder"; folder: Folder; x: number; y: number }
  | { kind: "tag"; tag: Tag; x: number; y: number };

export type ContextMenuItem = {
  id: string;
  label: string;
  icon: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

export type ContextMenuGroup = {
  label?: string;
  items: ContextMenuItem[];
};

export function ContextMenu({
  state,
  groups,
  onClose,
}: {
  state: Exclude<ContextMenuState, { kind: "closed" }>;
  groups: ContextMenuGroup[];
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState(() => ({ left: state.x, top: state.y }));

  useEffect(() => {
    if (!menuRef.current) {
      return;
    }
    const currentMenu = menuRef.current;

    const { width, height } = currentMenu.getBoundingClientRect();
    setPosition(clampContextMenuPosition(state.x, state.y, width, height));
  }, [groups, state.x, state.y]);

  useEffect(() => {
    if (!menuRef.current) {
      return;
    }
    const currentMenu = menuRef.current;

    function handlePointerDown(event: PointerEvent) {
      if (!currentMenu.contains(event.target as Node)) {
        onClose();
      }
    }

    function handleWindowContextMenu(event: MouseEvent) {
      if (!currentMenu.contains(event.target as Node)) {
        onClose();
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("contextmenu", handleWindowContextMenu);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("contextmenu", handleWindowContextMenu);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return (
    <div className="context-menu-layer">
      <div
        ref={menuRef}
        className="context-menu"
        role="menu"
        aria-label={state.kind === "bookmark" ? `${state.bookmark.title} 的右键菜单` : state.kind === "folder" ? `${state.folder.name} 的右键菜单` : `${state.tag.name} 的右键菜单`}
        style={{
          left: `${position.left}px`,
          top: `${position.top}px`,
        }}
      >
        {groups.map((group, groupIndex) => (
          <div key={`${state.kind}-${groupIndex}`}>
            {groupIndex > 0 ? <div className="context-menu-divider" aria-hidden="true" /> : null}
            {group.label ? <p className="context-menu-group-label">{group.label}</p> : null}
            {group.items.map((item) => (
              <button
                key={item.id}
                className={[
                  "context-menu-item",
                  item.danger ? "is-danger" : "",
                  item.disabled ? "is-disabled" : "",
                ].filter(Boolean).join(" ")}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  onClose();
                  item.onSelect();
                }}
              >
                <span className="context-menu-item-icon" aria-hidden="true">{item.icon}</span>
                <span className="context-menu-item-label">{item.label}</span>
                {item.shortcut ? <span className="context-menu-item-shortcut">{item.shortcut}</span> : null}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
