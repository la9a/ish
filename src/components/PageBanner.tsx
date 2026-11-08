import type { ReactNode } from "react";
import { BannerArtwork } from "@/components/BannerArtwork";

type Props = {
  eyebrow?: string;
  title: string;
  description?: string;
  image?: string;
  tone?: "lilac" | "lime" | "peach";
  children?: ReactNode;
  compact?: boolean;
  highlights?: { label: string; value: string | number }[];
  hint?: string;
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
  highlights,
  hint,
}: Props) {
  return (
    <section
      className={`sb-page-banner sb-banner-frame sb-banner-${tone}${compact ? " sb-banner-compact" : ""}`}
    >
      <div className="sb-banner-copy">
        {eyebrow && <p className="sb-banner-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="sb-banner-description">{description}</p>}
      </div>
      <div className="sb-banner-support">
        {highlights && highlights.length > 0 && (
          <dl className="sb-banner-highlights">
            {highlights.map(({ label, value }) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {children && <div className="sb-banner-actions">{children}</div>}
        {hint && <p className="sb-banner-hint">{hint}</p>}
      </div>
      <BannerArtwork image={image} className="sb-banner-art" />
    </section>
  );
}
