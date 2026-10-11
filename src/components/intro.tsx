"use client";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Runs before the page paints: the opening plays once each time the app is opened, not on refreshes or page changes. */
export const introScript =
  "try{if(!sessionStorage.getItem('sl-intro')){sessionStorage.setItem('sl-intro','1');document.documentElement.setAttribute('data-intro',matchMedia('(prefers-reduced-motion: reduce)').matches?'still':'play')}}catch(e){}";

/**
 * The opening: the shield lands, a ball streaks across, the name wipes in and light runs over the badge,
 * then it fades into the app. Pure CSS, so it starts with the first paint while the app loads underneath.
 * A tap skips it.
 */
export function Intro() {
  const html = () => document.documentElement;
  return (
    <div
      className="intro"
      aria-hidden="true"
      onClick={() => html().setAttribute("data-intro", "out")}
      onAnimationEnd={(e) => { if (e.target === e.currentTarget && e.animationName.startsWith("intro-out")) html().removeAttribute("data-intro"); }}
    >
      <div className="intro-stage">
        <div className="intro-shield">
          <img src={`${base}/brand/shield.png`} width={354} height={400} alt="" />
          <span className="intro-sweep" style={{ maskImage: `url(${base}/brand/shield.png)`, WebkitMaskImage: `url(${base}/brand/shield.png)` }} />
          <span className="intro-swoosh" />
        </div>
        <img className="intro-word" src={`${base}/brand/wordmark.png`} width={723} height={90} alt="" />
        <img className="intro-rule" src={`${base}/brand/rule.png`} width={723} height={45} alt="" />
      </div>
    </div>
  );
}
