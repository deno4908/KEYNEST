import { useId, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function SecurityDisclosure({
  title,
  description,
  icon,
  disabled = false,
  onClose,
  children,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  disabled?: boolean;
  onClose?: () => void;
  children: ReactNode | ((open: boolean) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={`member-security-disclosure ${open ? "is-open" : ""}`}>
      <button
        type="button"
        className="member-security-toggle"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        onClick={() => {
          if (open) onClose?.();
          setOpen((value) => !value);
        }}
      >
        <span className="member-security-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="member-security-toggle-copy">
          <strong>{title}</strong>
          <small>{open ? "Bấm để thu gọn" : description}</small>
        </span>
        <ChevronDown
          size={18}
          className="member-security-chevron"
          aria-hidden="true"
        />
      </button>
      <div
        id={id}
        className="member-security-collapse"
        inert={!open}
        aria-hidden={!open}
      >
        <div>{typeof children === "function" ? children(open) : children}</div>
      </div>
    </div>
  );
}
