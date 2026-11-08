import { colorBannerUrls } from "@/assets/color-banners/urls";
import { detailedCatUrls } from "@/assets/detailed-cats/urls";

const known = new Set(
  [
    "hero",
    "connect",
    "monitor",
    "register",
    "code",
    "note",
    "code-sending",
    "code-failure",
    "edit-client",
    "reconnect",
    "add-group",
    "edit-draft",
    "single",
    "single-select",
    "multi",
    "multi-select",
    "registration-help",
    "login",
  ].map((stem) => `/art/cat-${stem}.svg`),
);

const subjectAssets: Record<string, string> = {
  "/art/cat-connect.svg": "/art/cat-connect-detailed.png",
  "/art/cat-monitor.svg": "/art/cat-monitor-detailed.png",
  "/art/cat-code.svg": "/art/cat-code-detailed.png",
  "/art/cat-code-sending.svg": "/art/cat-code-sending-detailed.png",
  "/art/cat-edit-client.svg": "/art/cat-edit-client-detailed.png",
  "/art/cat-reconnect.svg": "/art/cat-reconnect-detailed.png",
  "/art/cat-add-group.svg": "/art/cat-add-group-detailed.png",
  "/art/cat-edit-draft.svg": "/art/cat-edit-draft-detailed.png",
  "/art/cat-single.svg": "/art/cat-single-detailed.png",
  "/art/cat-single-select.svg": "/art/cat-single-select-detailed.png",
  "/art/cat-multi.svg": "/art/cat-multi-detailed.png",
  "/art/cat-multi-select.svg": "/art/cat-multi-select-detailed.png",
  "/art/cat-registration-help.svg": "/art/cat-registration-help-detailed.png",
  "/art/cat-login.svg": "/art/cat-login-detailed.png",
  "/art/cat-code-failure.svg": "/art/code-failure-paper-plane.png",
};

// Lovable's asset endpoint is not available in an exported/local checkout.
// Keep the bundled artwork as a fallback, without hiding broken illustrations.
const bundledSubjects: Record<string, string> = {
  "/art/cat-connect.svg": "/art/cat-connect-complete-cables.png",
  "/art/cat-code-sending.svg": "/art/cat-code-sending-subject.png",
  "/art/cat-code-failure.svg": "/art/code-failure-paper-plane.png",
  "/art/cat-multi.svg": "/art/cat-multi-natural.png",
  "/art/cat-multi-select.svg": "/art/cat-multi-select-natural.png",
};
const revisedSubjects: Record<string, string> = {
  "/art/cat-note.svg": "/art/cat-note-refined.png",
  "/art/cat-reconnect.svg": "/art/cat-reconnect-servers.png",
};

function handleArtworkError(event: React.SyntheticEvent<HTMLImageElement>, fallback: string) {
  const image = event.currentTarget;
  if (image.getAttribute("src") !== fallback) image.src = fallback;
}

// File selection and framing are independent: torso scenes retain their bleed.
const completeCharacters = new Set([
  "/art/cat-reconnect.svg",
  "/art/cat-connect.svg",
  "/art/cat-code-sending.svg",
  "/art/cat-code-failure.svg",
  "/art/cat-multi.svg",
  "/art/cat-multi-select.svg",
]);

/** Backgrounds fill the card; characters extend slightly below its clipped lower edge. */
export function BannerArtwork({
  image,
  className,
  priority = false,
}: {
  image: string;
  className: string;
  priority?: boolean;
}) {
  const layered = known.has(image);
  const complete = completeCharacters.has(image);
  const subject = subjectAssets[image] ?? image.replace(".svg", "-subject.svg");
  const background = layered ? image.replace(".svg", "-background.svg") : image;
  return (
    <span
      className={`${className} sb-art-scene`}
      data-artwork={image.replace("/art/cat-", "").replace(".svg", "")}
      data-complete-character={complete || undefined}
      aria-hidden="true"
    >
      <img
        className="sb-art-background"
        src={colorBannerUrls[background] ?? background}
        onError={(event) => handleArtworkError(event, background)}
        alt=""
        fetchPriority={priority ? "high" : "auto"}
      />
      {layered && (
        <img
          className="sb-art-subject"
          data-cat-subject=""
          src={
            revisedSubjects[image] ??
            detailedCatUrls[subject] ??
            colorBannerUrls[subject] ??
            subject
          }
          onError={(event) =>
            handleArtworkError(
              event,
              revisedSubjects[image] ??
                bundledSubjects[image] ??
                image.replace(".svg", "-subject.svg"),
            )
          }
          alt=""
          fetchPriority={priority ? "high" : "auto"}
        />
      )}
    </span>
  );
}
