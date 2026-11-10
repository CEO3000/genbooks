"use client";

import { useEffect, useRef } from "react";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export default function Turnstile({ onToken }) {
  const ref = useRef(null);
  const widgetId = useRef(null);

  useEffect(() => {
    if (!SITE_KEY) return;

    function render() {
      if (!ref.current || widgetId.current !== null || !window.turnstile) return;
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY,
        // Confirmed via Cloudflare's own docs: "normal" is a fixed 300px
        // width, and "flexible" is not actually unlimited either - it's
        // "100% width (min: 300px)". On a narrow phone form, the real
        // available space (viewport minus the page's own padding minus
        // this form's own padding) can genuinely be under 300px, so
        // flexible mode still can't shrink enough no matter what CSS
        // surrounds it - confirmed for real, twice, on an actual device.
        // "compact" is a real fixed 150x140px footprint, comfortably
        // under any reasonable mobile form's available width.
        size: "compact",
        callback: onToken,
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null),
      });
    }

    if (window.turnstile) {
      render();
    } else {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.onload = render;
      document.head.appendChild(script);
    }

    return () => {
      if (widgetId.current !== null && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, [onToken]);

  if (!SITE_KEY) {
    return <p className="text-xs text-[var(--danger)]">Captcha not configured.</p>;
  }

  // min-w-0 overrides flexbox's default min-width:auto, which otherwise
  // refuses to let a flex item (every usage of this component sits inside
  // a flex flex-col form) shrink below its content's own intrinsic width.
  // Not strictly needed now that "compact" has a small fixed footprint
  // well under any real container width, but harmless to keep as a
  // defensive default. justify-center centers the fixed-width widget
  // within the full-width wrapper, since compact mode itself doesn't.
  return <div ref={ref} className="w-full min-w-0 flex justify-center" />;
}
