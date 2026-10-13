import Link from "next/link";
import { Arrow } from "@/components/arrow";
import { DesignSwitcher } from "@/components/design-switcher";
import { site } from "@/lib/site";

export default function Home() {
  return (
    <div className="page-shell">
      <header className="site-header">
        <Link className="wordmark" href="/" aria-label={`${site.name} home`}>
          <span className="brand-mark" aria-hidden="true"><Arrow /></span>
          {site.name}<span className="wordmark-dot">.</span>
        </Link>
        <span className="header-note">A work in progress</span>
      </header>
      <DesignSwitcher current="original" />
      <main id="main" className="hero" tabIndex={-1}>
        <p className="eyebrow"><span aria-hidden="true" /> Something new is on its way</p>
        <h1>Something worth<br /><span>exchanging.</span></h1>
        <p className="intro">A home for every trading card.<br />Organize your collection, one binder at a time.</p>
        <div className="coming-soon">Coming soon <Arrow /></div>
        <p className="collection-entry"><a href="/portfolio">Start your card collection <span aria-hidden="true"><Arrow /></span></a><span>Cards, binders, and notes. No account needed.</span></p>
        <div className="exchange-art" aria-hidden="true">
          <div className="exchange-card card-first"><span>01</span><Arrow /></div>
          <div className="exchange-card card-second"><span>02</span><Arrow className="arrow-back" /></div>
        </div>
      </main>
      <footer className="site-footer">
        <span>Good things change hands.</span>
        <span>In the making</span>
      </footer>
    </div>
  );
}
