import type { ReactNode } from "react";

type Props = {
  eyebrow?: string;
  title: string;
  description?: string;
  image?: string;
  tone?: "lilac" | "lime" | "peach";
  children?: ReactNode;
  compact?: boolean;
};

/** Shared framing, with a distinct illustration and content for each workspace. */
export function PageBanner({
  eyebrow,
  title,
  description,
  image = "/art/cat-hero.svg",
  tone = "lilac",
  children,
  compact = false,
}: Props) {
  return (
    <section className={`sb-page-banner sb-banner-${tone}${compact ? " sb-banner-compact" : ""}`}>
      <div className="sb-banner-copy">
        {eyebrow && <p className="sb-banner-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="sb-banner-description">{description}</p>}
        {children && <div className="sb-banner-actions">{children}</div>}
      </div>
      <div className="sb-banner-art" aria-hidden="true">
        <img src={image} alt="" />
      </div>
    </section>
  );
}
