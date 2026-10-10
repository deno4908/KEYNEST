import { useState } from "react";

export function Avatar({
  name,
  url,
  className,
}: {
  name: string;
  url?: string | null;
  className: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(-2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?";
  return (
    <span className={className} aria-hidden="true">
      {url && failed !== url ? (
        <img
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(url)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            borderRadius: "inherit",
            display: "block",
          }}
        />
      ) : (
        initials
      )}
    </span>
  );
}
